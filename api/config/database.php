<?php
/**
 * Database connection settings.
 *
 * Create the MySQL user with rights on this database only, and keep this
 * password out of git (api/.env is ignored).
 */

declare(strict_types=1);

use Shn\Helpers\Env;

return [
    'host' => Env::get('DB_HOST', '127.0.0.1'),
    'port' => Env::int('DB_PORT', 3306),
    'name' => Env::get('DB_NAME', ''),
    'user' => Env::get('DB_USER', ''),
    'password' => Env::get('DB_PASSWORD', ''),
    'charset' => Env::get('DB_CHARSET', 'utf8mb4'),
];
