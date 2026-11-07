<?php
/**
 * Uploaded media (featured images, logos, open-graph images).
 *
 * Files are validated by content (finfo + getimagesize), renamed, stored outside
 * the PHP-executable path and recorded in the database.
 */

declare(strict_types=1);

namespace Shn\Models;

use PDO;
use Shn\Helpers\ApiException;
use Shn\Helpers\Config;
use Shn\Helpers\Security;

final class MediaModel extends BaseModel
{
    protected string $table = 'media';
    protected bool $softDeletes = false;

    /** @return array<string,mixed> */
    public function store(array $file, ?int $adminId, ?string $altText = null): array
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            throw ApiException::unprocessable($this->uploadErrorMessage($error), ['file' => 'Upload failed.']);
        }

        $size = (int) ($file['size'] ?? 0);
        $maxBytes = Config::int('uploads.max_bytes', 5 * 1024 * 1024);
        if ($size <= 0 || $size > $maxBytes) {
            throw ApiException::unprocessable(
                'Images must be smaller than ' . round($maxBytes / 1048576, 1) . ' MB.',
                ['file' => 'File too large.'],
            );
        }

        $tmpPath = (string) ($file['tmp_name'] ?? '');
        if ($tmpPath === '' || !is_uploaded_file($tmpPath)) {
            throw ApiException::unprocessable('The upload could not be read.', ['file' => 'Invalid upload.']);
        }

        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($tmpPath);
        $allowed = Config::array('uploads.allowed_mime');
        if (!in_array($mime, $allowed, true)) {
            throw ApiException::unprocessable('Unsupported image type: ' . $mime . '.', ['file' => 'Unsupported type.']);
        }

        $extension = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
        $extensionMap = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/avif' => 'avif',
            'image/svg+xml' => 'svg',
        ];
        $extension = $extensionMap[$mime] ?? $extension;
        if (!in_array($extension, Config::array('uploads.allowed_ext'), true)) {
            throw ApiException::unprocessable('Unsupported file extension.', ['file' => 'Unsupported extension.']);
        }

        $width = null;
        $height = null;
        if ($mime !== 'image/svg+xml') {
            $dimensions = @getimagesize($tmpPath);
            if ($dimensions === false) {
                throw ApiException::unprocessable('That file is not a readable image.', ['file' => 'Corrupt image.']);
            }
            $width = (int) $dimensions[0];
            $height = (int) $dimensions[1];
            if ($width > 8000 || $height > 8000) {
                throw ApiException::unprocessable('Images must be 8000px or smaller on each side.', ['file' => 'Image too large.']);
            }
        } else {
            $this->assertSafeSvg($tmpPath);
        }

        $baseDir = rtrim(Config::string('uploads.path', dirname(__DIR__) . '/uploads'), '/');
        $subDir = 'library/' . gmdate('Y/m');
        $targetDir = $baseDir . '/' . $subDir;
        if (!is_dir($targetDir) && !@mkdir($targetDir, 0775, true) && !is_dir($targetDir)) {
            throw ApiException::server('The uploads folder is not writable. Set permissions to 0755.');
        }

        $safeName = Security::isSafeFilename((string) ($file['name'] ?? ''))
            ? preg_replace('/\.[a-zA-Z0-9]+$/', '', (string) $file['name'])
            : 'image';
        $filename = gmdate('Ymd-His') . '-' . substr(bin2hex(random_bytes(4)), 0, 6) . '-' . Security::plainText($safeName, 40) . '.' . $extension;
        $filename = preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $filename) ?? 'image.' . $extension;

        $targetPath = $targetDir . '/' . $filename;
        if (!@move_uploaded_file($tmpPath, $targetPath)) {
            throw ApiException::server('The file could not be saved.');
        }
        @chmod($targetPath, 0644);

        $relativeUrl = rtrim(Config::string('uploads.url', '/api/uploads'), '/') . '/' . $subDir . '/' . $filename;

        $statement = $this->pdo()->prepare(
            'INSERT INTO media (filename, original_name, mime_type, size_bytes, width, height, path, alt_text, uploaded_by)
             VALUES (:filename, :original_name, :mime_type, :size_bytes, :width, :height, :path, :alt_text, :uploaded_by)',
        );
        $statement->execute([
            ':filename' => $filename,
            ':original_name' => Security::plainText((string) ($file['name'] ?? 'upload'), 190),
            ':mime_type' => $mime,
            ':size_bytes' => $size,
            ':width' => $width,
            ':height' => $height,
            ':path' => $relativeUrl,
            ':alt_text' => $altText !== null ? Security::plainText($altText, 200) : null,
            ':uploaded_by' => $adminId,
        ]);

        return $this->findOrFail((int) $this->pdo()->lastInsertId());
    }

    /** @return array{items:array<int,array<string,mixed>>,meta:array<string,mixed>} */
    public function adminList(int $page, int $perPage): array
    {
        $total = (int) $this->pdo()->query('SELECT COUNT(*) FROM media')->fetchColumn();
        $offset = ($page - 1) * $perPage;

        $statement = $this->pdo()->prepare(
            'SELECT m.*, a.name AS uploaded_by_name
               FROM media m LEFT JOIN admins a ON a.id = m.uploaded_by
              ORDER BY m.created_at DESC, m.id DESC LIMIT ' . $perPage . ' OFFSET ' . $offset,
        );
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return [
            'items' => array_map([$this, 'hydrate'], $rows),
            'meta' => $this->paginationMeta($total, $page, $perPage),
        ];
    }

    /** @return array<string,mixed> */
    public function findOrFail(int $id): array
    {
        $statement = $this->pdo()->prepare(
            'SELECT m.*, a.name AS uploaded_by_name FROM media m LEFT JOIN admins a ON a.id = m.uploaded_by
              WHERE m.id = :id LIMIT 1',
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw ApiException::notFound('Media item not found.');
        }
        return $this->hydrate($row);
    }

    public function delete(int $id): void
    {
        $item = $this->findOrFail($id);

        $baseDir = rtrim(Config::string('uploads.path', dirname(__DIR__) . '/uploads'), '/');
        $prefix = rtrim(Config::string('uploads.url', '/api/uploads'), '/') . '/';
        $relative = str_starts_with((string) $item['path'], $prefix)
            ? substr((string) $item['path'], strlen($prefix))
            : null;

        if ($relative !== null && !str_contains($relative, '..')) {
            $absolute = $baseDir . '/' . $relative;
            if (is_file($absolute)) {
                @unlink($absolute);
            }
        }

        $this->pdo()->prepare('DELETE FROM media WHERE id = :id')->execute([':id' => $id]);
    }

    private function assertSafeSvg(string $path): void
    {
        $contents = (string) file_get_contents($path, false, null, 0, 200000);
        $lower = strtolower($contents);

        foreach (['<script', '<foreignobject', 'javascript:', 'onload=', 'onerror=', '<iframe'] as $needle) {
            if (str_contains($lower, $needle)) {
                throw ApiException::unprocessable('This SVG contains active content and was rejected.', ['file' => 'Unsafe SVG.']);
            }
        }
    }

    private function uploadErrorMessage(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'The file is larger than the server allows.',
            UPLOAD_ERR_PARTIAL => 'The upload was interrupted. Please try again.',
            UPLOAD_ERR_NO_FILE => 'Choose a file to upload.',
            UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE => 'The server could not store the file.',
            default => 'The upload failed. Please try again.',
        };
    }

    /** @param array<string,mixed> $row */
    private function hydrate(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'filename' => $row['filename'],
            'original_name' => $row['original_name'],
            'mime_type' => $row['mime_type'],
            'size_bytes' => (int) $row['size_bytes'],
            'width' => $row['width'] !== null ? (int) $row['width'] : null,
            'height' => $row['height'] !== null ? (int) $row['height'] : null,
            'url' => $row['path'],
            'alt_text' => $row['alt_text'],
            'uploaded_by' => $row['uploaded_by'] !== null ? (int) $row['uploaded_by'] : null,
            'uploaded_by_name' => $row['uploaded_by_name'] ?? null,
            'created_at' => $row['created_at'],
        ];
    }
}
