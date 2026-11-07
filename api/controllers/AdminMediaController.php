<?php
/**
 * Admin media library.
 */

declare(strict_types=1);

namespace Shn\Controllers;

use Shn\Helpers\ApiException;
use Shn\Helpers\Logger;
use Shn\Helpers\Request;
use Shn\Helpers\Response;
use Shn\Models\MediaModel;

final class AdminMediaController extends Controller
{
    public function __construct(
        Request $request,
        private readonly MediaModel $media = new MediaModel(),
    ) {
        parent::__construct($request);
    }

    public function index(Request $request): void
    {
        unset($request);
        ['page' => $page, 'per_page' => $perPage] = $this->pagination(24, 60);

        $result = $this->media->adminList($page, $perPage);
        Response::paginated($result['items'], $result['meta']);
    }

    public function store(Request $request): void
    {
        $file = $request->file('file');
        if ($file === null) {
            throw ApiException::unprocessable('Choose an image to upload.', ['file' => 'No file received.']);
        }

        $alt = $request->input('alt_text');
        $item = $this->media->store($file, $this->adminId(), is_string($alt) ? $alt : null);

        Logger::audit($request->admin, 'media.uploaded', 'media', $item['id'], 'Uploaded ' . $item['filename'], $request->ip());

        Response::created($item);
    }

    public function destroy(Request $request, string $id): void
    {
        $mediaId = $this->id($id, 'media id');
        $this->media->delete($mediaId);

        Logger::audit($request->admin, 'media.deleted', 'media', $mediaId, 'Deleted a media item', $request->ip());
        Response::noContent();
    }
}
