<?php
declare(strict_types=1);

require_once __DIR__ . '/extensions.php';

/** Remove only a real child directory of the supplied private extensions root. */
function df_extension_remove_tree(string $target, string $expectedParent): void
{
    $parent = realpath($expectedParent);
    $realTarget = realpath($target);
    $isExtensionRoot = rtrim($expectedParent, DIRECTORY_SEPARATOR) === rtrim(df_extensions_root(), DIRECTORY_SEPARATOR);
    if ($parent === false || ($isExtensionRoot && !df_extensions_root_is_private())
        || $realTarget === false || dirname($realTarget) !== $parent || is_link($target)
    ) {
        throw new RuntimeException('Extension directory could not be safely removed.');
    }
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($realTarget, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        $path = $item->getPathname();
        if ($item->isLink() || $item->isFile()) {
            if (!@unlink($path)) {
                throw new RuntimeException('An extension file could not be removed.');
            }
        } elseif ($item->isDir() && !@rmdir($path)) {
            throw new RuntimeException('An extension subdirectory could not be removed.');
        }
    }
    if (!@rmdir($realTarget)) {
        throw new RuntimeException('Extension directory could not be removed.');
    }
}

/** Install a strict <slug>/plugin.json ZIP into the private storage/extensions directory. */
function df_install_extension_zip(PDO $pdo, array $upload, int $adminId): array
{
    if (!class_exists(ZipArchive::class)) {
        throw new RuntimeException('PHP ZipArchive is not enabled on this hosting account.');
    }
    $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($error !== UPLOAD_ERR_OK) {
        throw new RuntimeException($error === UPLOAD_ERR_NO_FILE
            ? 'Choose a ZIP file first.'
            : 'ZIP upload failed. Check PHP upload_max_filesize and post_max_size.');
    }
    $temporaryUpload = (string) ($upload['tmp_name'] ?? '');
    $originalName = (string) ($upload['name'] ?? '');
    $fileSize = (int) ($upload['size'] ?? 0);
    if (!is_uploaded_file($temporaryUpload) || $fileSize < 22 || $fileSize > 20 * 1024 * 1024
        || !preg_match('/\.zip$/i', $originalName)
    ) {
        throw new RuntimeException('Choose a valid ZIP archive no larger than 20 MB.');
    }

    $root = df_extensions_root();
    if (!is_dir($root) && !@mkdir($root, 0750, true) && !is_dir($root)) {
        throw new RuntimeException('Private extension storage is not writable.');
    }
    @chmod($root, 0750);
    $realRoot = realpath($root);
    if ($realRoot === false || !df_extensions_root_is_private()) {
        throw new RuntimeException('Private extension storage path is invalid or is not inside storage/.');
    }

    $zip = new ZipArchive();
    $openResult = $zip->open($temporaryUpload, ZipArchive::CHECKCONS);
    if ($openResult !== true || $zip->numFiles < 1 || $zip->numFiles > 2500) {
        if ($openResult === true) $zip->close();
        throw new RuntimeException('ZIP archive is corrupt or contains too many files.');
    }
    $zipOpen = true;

    $stage = $root . '/.staging-' . bin2hex(random_bytes(12));
    if (!@mkdir($stage, 0750)) {
        $zip->close();
        throw new RuntimeException('Could not create a private installation workspace.');
    }
    @chmod($stage, 0750);
    $archiveSlug = '';
    $seen = [];
    $totalBytes = 0;
    $fileCount = 0;
    $finalPath = null;
    $finalDirectoryCreated = false;
    $installTransactionStarted = false;

    try {
        for ($index = 0; $index < $zip->numFiles; $index++) {
            $name = $zip->getNameIndex($index);
            $stat = $zip->statIndex($index);
            if (!is_string($name) || !is_array($stat) || $name === '' || strlen($name) > 512
                || str_contains($name, "\0") || str_contains($name, '\\') || str_contains($name, ':') || str_starts_with($name, '/')
                || preg_match('/^[A-Za-z]:/', $name)
            ) {
                throw new RuntimeException('ZIP contains an unsafe file path.');
            }
            $isDirectory = str_ends_with($name, '/');
            $trimmedName = $isDirectory ? substr($name, 0, -1) : $name;
            $segments = explode('/', $trimmedName);
            if (count($segments) < 1 || in_array('', $segments, true) || in_array('.', $segments, true) || in_array('..', $segments, true)) {
                throw new RuntimeException('ZIP contains a path traversal entry.');
            }
            $top = (string) $segments[0];
            if (!df_extension_slug_is_valid($top)) {
                throw new RuntimeException('The ZIP root folder must be a lowercase plugin slug.');
            }
            if ($archiveSlug === '') {
                $archiveSlug = $top;
            } elseif ($archiveSlug !== $top) {
                throw new RuntimeException('ZIP must contain exactly one top-level plugin folder.');
            }
            if (count($segments) === 1 && !$isDirectory) {
                throw new RuntimeException('Plugin files must be inside the top-level plugin folder.');
            }
            foreach (array_slice($segments, 1) as $segment) {
                $lowerSegment = strtolower($segment);
                if (in_array($lowerSegment, ['.htaccess','.user.ini','web.config','php.ini'], true)
                    || preg_match('/^\\.env(?:\\.|$)/i', $segment)
                ) {
                    throw new RuntimeException('Server configuration and environment files are not allowed in plugin ZIPs.');
                }
            }

            $lowerName = strtolower($trimmedName);
            if (isset($seen[$lowerName])) {
                throw new RuntimeException('ZIP contains duplicate paths.');
            }
            $seen[$lowerName] = true;

            if (method_exists($zip, 'getExternalAttributesIndex')) {
                $opsys = 0;
                $attributes = 0;
                if ($zip->getExternalAttributesIndex($index, $opsys, $attributes)
                    && $opsys === ZipArchive::OPSYS_UNIX
                    && (($attributes >> 16) & 0170000) === 0120000
                ) {
                    throw new RuntimeException('Symbolic links are not allowed in extension ZIPs.');
                }
            }

            $relative = implode('/', array_slice($segments, 1));
            if ($relative === '') continue;
            $target = $stage . '/' . $relative;
            if ($isDirectory) {
                if (!is_dir($target) && !@mkdir($target, 0750, true) && !is_dir($target)) {
                    throw new RuntimeException('Could not create a plugin subdirectory.');
                }
                @chmod($target, 0750);
                continue;
            }

            $declaredSize = (int) ($stat['size'] ?? -1);
            if ($declaredSize < 0 || $declaredSize > 10 * 1024 * 1024) {
                throw new RuntimeException('An extension file exceeds the 10 MB per-file limit.');
            }
            $totalBytes += $declaredSize;
            $fileCount++;
            if ($totalBytes > 60 * 1024 * 1024 || $fileCount > 2000) {
                throw new RuntimeException('Extension expands beyond the safe size or file-count limit.');
            }
            $parent = dirname($target);
            if (!is_dir($parent) && !@mkdir($parent, 0750, true) && !is_dir($parent)) {
                throw new RuntimeException('Could not create a plugin subdirectory.');
            }
            $realParent = realpath($parent);
            $realStage = realpath($stage);
            if ($realParent === false || $realStage === false || ($realParent !== $realStage && !str_starts_with($realParent, $realStage . DIRECTORY_SEPARATOR))) {
                throw new RuntimeException('ZIP entry escaped the staging directory.');
            }
            $stream = $zip->getStream($name);
            $output = @fopen($target, 'xb');
            if (!is_resource($stream) || !is_resource($output)) {
                if (is_resource($stream)) fclose($stream);
                if (is_resource($output)) fclose($output);
                throw new RuntimeException('Could not safely extract an extension file.');
            }
            $written = 0;
            try {
                while (!feof($stream)) {
                    $chunk = fread($stream, 8192);
                    if ($chunk === false) throw new RuntimeException('ZIP file could not be read.');
                    if ($chunk === '') {
                        if (feof($stream)) break;
                        throw new RuntimeException('ZIP stream returned an empty read before end-of-file.');
                    }
                    $written += strlen($chunk);
                    if ($written > $declaredSize || $written > 10 * 1024 * 1024) {
                        throw new RuntimeException('ZIP entry expanded beyond its declared size.');
                    }
                    $offset = 0;
                    $chunkLength = strlen($chunk);
                    while ($offset < $chunkLength) {
                        $part = fwrite($output, substr($chunk, $offset));
                        if ($part === false || $part === 0) throw new RuntimeException('Extension file could not be written.');
                        $offset += $part;
                    }
                }
            } finally {
                fclose($stream);
                fclose($output);
            }
            if ($written !== $declaredSize) {
                throw new RuntimeException('ZIP entry size did not match its directory record.');
            }
            @chmod($target, 0640);
        }
        if (!$zip->close()) throw new RuntimeException('ZIP archive could not be closed after validation.');
        $zipOpen = false;

        if (!df_extension_slug_is_valid($archiveSlug)) {
            throw new RuntimeException('Plugin slug is invalid.');
        }
        $manifestPath = $stage . '/plugin.json';
        if (!is_file($manifestPath)) {
            throw new RuntimeException('ZIP must place plugin.json at the top of its plugin folder.');
        }
        $rawManifest = @file_get_contents($manifestPath);
        if (!is_string($rawManifest) || strlen($rawManifest) > 16384) {
            throw new RuntimeException('Plugin manifest is missing or too large.');
        }
        try {
            $manifest = json_decode($rawManifest, true, 32, JSON_THROW_ON_ERROR);
        } catch (Throwable $error) {
            throw new RuntimeException('Plugin manifest is not valid JSON.');
        }
        if (!is_array($manifest) || ($manifest['slug'] ?? null) !== $archiveSlug) {
            throw new RuntimeException('Manifest slug must match the ZIP top-level folder.');
        }
        $inspected = df_extension_inspect_staging($stage, $archiveSlug);
        if ($inspected === null) {
            throw new RuntimeException('Plugin manifest or PHP entry file is invalid.');
        }

        $exists = $pdo->prepare('SELECT 1 FROM cms_extensions WHERE slug = :slug LIMIT 1');
        $exists->execute(['slug' => $archiveSlug]);
        if ($exists->fetchColumn() || file_exists($root . '/' . $archiveSlug) || is_link($root . '/' . $archiveSlug)) {
            throw new RuntimeException('That plugin slug is already installed. Deactivate and uninstall it before installing a replacement.');
        }
        $pdo->beginTransaction();
        $installTransactionStarted = true;
        $finalPath = $root . '/' . $archiveSlug;
        if (!@rename($stage, $finalPath)) {
            throw new RuntimeException('Could not move the validated plugin into its isolated install directory.');
        }
        $finalDirectoryCreated = true;
        @chmod($finalPath, 0750);
        $insert = $pdo->prepare("INSERT INTO cms_extensions (slug,name,version,status,options_json,installed_by) VALUES (:slug,:name,:version,'inactive','{}',:admin)");
        $insert->execute([
            'slug' => $archiveSlug,
            'name' => trim((string) $manifest['name']),
            'version' => (string) $manifest['version'],
            'admin' => $adminId,
        ]);
        $pdo->commit();
        $installTransactionStarted = false;
        return ['slug' => $archiveSlug, 'name' => trim((string) $manifest['name']), 'version' => (string) $manifest['version']];
    } catch (Throwable $error) {
        if ($installTransactionStarted && $pdo->inTransaction()) {
            try { $pdo->rollBack(); } catch (Throwable $rollbackError) {
                error_log('Extension install rollback failed: ' . $rollbackError->getMessage());
            }
        }
        if ($zipOpen) {
            @$zip->close();
        }
        $cleanupPath = $finalDirectoryCreated && is_string($finalPath) ? $finalPath : $stage;
        if (is_dir($cleanupPath)) {
            try {
                df_extension_remove_tree($cleanupPath, $root);
            } catch (Throwable $cleanupError) {
                error_log('Extension install cleanup failed: ' . $cleanupError->getMessage());
            }
        }
        throw $error;
    }
}

/** Validate a manifest before the staged directory has been renamed into its final location. */
function df_extension_inspect_staging(string $directory, string $expectedSlug): ?array
{
    if (!df_extension_slug_is_valid($expectedSlug) || is_link($directory)) return null;
    $manifestPath = $directory . '/plugin.json';
    if (is_link($manifestPath)) return null;
    $raw = @file_get_contents($manifestPath);
    if (!is_string($raw) || strlen($raw) > 16384) return null;
    try {
        $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (Throwable $error) {
        return null;
    }
    if (!is_array($decoded)
        || ($decoded['slug'] ?? null) !== $expectedSlug
        || !is_string($decoded['name'] ?? null) || trim($decoded['name']) === '' || strlen($decoded['name']) > 120
        || !is_string($decoded['version'] ?? null)
        || preg_match('/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:[-+][A-Za-z0-9.-]{1,20})?$/', $decoded['version']) !== 1
        || (int) ($decoded['api_version'] ?? 0) !== 1
        || !is_string($decoded['entry'] ?? null)
    ) return null;
    $entry = $decoded['entry'];
    if (strlen($entry) > 180 || str_starts_with($entry, '/') || str_contains($entry, '\\') || str_contains($entry, '..')
        || preg_match('/^[A-Za-z0-9._\/-]+\.php$/', $entry) !== 1
        || df_extension_path_has_symlink($directory, $entry)
    ) return null;
    $realDirectory = realpath($directory);
    $realEntry = realpath($directory . '/' . $entry);
    if ($realDirectory === false || $realEntry === false || !is_file($realEntry)
        || !str_starts_with($realEntry, $realDirectory . DIRECTORY_SEPARATOR)
    ) return null;
    return ['manifest' => $decoded, 'directory' => $realDirectory, 'entry_path' => $realEntry];
}
