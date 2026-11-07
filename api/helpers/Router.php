<?php
/**
 * Tiny router: exact HTTP method + `/v1/path/{param}` patterns.
 *
 * Route definition (routes/api.php):
 *   ['GET', '/v1/services', [ServiceController::class, 'index'], ['cors']]
 *   ['PUT', '/v1/admin/services/{id}', [ServiceController::class, 'update'], ['cors','auth','csrf','role:editor']]
 */

declare(strict_types=1);

namespace Shn\Helpers;

use Shn\Middleware\AuthMiddleware;
use Shn\Middleware\CorsMiddleware;
use Shn\Middleware\CsrfMiddleware;
use Shn\Middleware\RateLimitMiddleware;
use Shn\Middleware\RoleMiddleware;
use Throwable;

final class Router
{
    /** @var array<int,array{method:string,regex:string,params:array<int,string>,class:string,action:string,middleware:array<int,string>}> */
    private array $routes = [];

    /** @var array<int,string> */
    private array $allowedMethods = [];

    public static function boot(): self
    {
        $router = new self();
        /** @var array<int,array{0:string,1:string,2:array{0:class-string,1:string},3?:array<int,string>}> $definitions */
        $definitions = require dirname(__DIR__) . '/routes/api.php';
        foreach ($definitions as $definition) {
            $router->add(
                $definition[0],
                $definition[1],
                $definition[2],
                $definition[3] ?? [],
            );
        }
        return $router;
    }

    /**
     * @param array{0:class-string,1:string} $handler
     * @param array<int,string> $middleware
     */
    public function add(string $method, string $pattern, array $handler, array $middleware = []): void
    {
        $params = [];
        $regex = preg_replace_callback(
            '/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/',
            static function (array $match) use (&$params): string {
                $params[] = $match[1];
                return '(?P<' . $match[1] . '>[^/]+)';
            },
            $pattern,
        ) ?? $pattern;

        $this->routes[] = [
            'method' => strtoupper($method),
            'regex' => '#^' . $regex . '$#',
            'params' => $params,
            'class' => $handler[0],
            'action' => $handler[1],
            'middleware' => $middleware,
        ];
    }

    public function dispatch(?Request $request = null): void
    {
        $request ??= Request::capture();

        try {
            $this->handle($request);
        } catch (ApiException $exception) {
            Response::fromException($exception);
        } catch (Throwable $error) {
            error_log('[router] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
            $debug = Config::bool('app.debug', false);
            Response::error(
                500,
                'server_error',
                $debug ? $error->getMessage() : 'Unexpected server error. The incident has been logged.',
            );
        }
    }

    private function handle(Request $request): void
    {
        // CORS runs before routing so pre-flight requests succeed even for 404s.
        (new CorsMiddleware())->handle($request);

        $path = $request->path();
        $method = $request->method();
        $this->allowedMethods = [];

        foreach ($this->routes as $route) {
            if (!preg_match($route['regex'], $path, $matches)) {
                continue;
            }

            if ($route['method'] !== $method) {
                $this->allowedMethods[] = $route['method'];
                continue;
            }

            /** @var array<string,string> $params */
            $params = [];
            foreach ($route['params'] as $name) {
                $params[$name] = rawurldecode((string) ($matches[$name] ?? ''));
            }

            foreach ($route['middleware'] as $definition) {
                $this->runMiddleware($definition, $request);
            }

            $class = $route['class'];
            if (!class_exists($class)) {
                throw ApiException::server('Route handler is missing: ' . $class);
            }

            $controller = new $class($request);
            $action = $route['action'];
            if (!method_exists($controller, $action)) {
                throw ApiException::server('Route action is missing: ' . $class . '::' . $action);
            }

            $controller->{$action}($request, ...array_values($params));
            return;
        }

        if ($this->allowedMethods !== []) {
            $unique = array_values(array_unique($this->allowedMethods));
            if (!headers_sent()) {
                header('Allow: ' . implode(', ', $unique));
            }
            throw ApiException::methodNotAllowed(
                'Method ' . $method . ' is not allowed for ' . $path . '. Allowed: ' . implode(', ', $unique),
            );
        }

        throw ApiException::notFound('No API route matches ' . $path . '.');
    }

    private function runMiddleware(string $definition, Request $request): void
    {
        [$name, $argument] = array_pad(explode(':', $definition, 2), 2, null);

        switch ($name) {
            case 'cors':
                // already executed globally
                return;
            case 'auth':
                (new AuthMiddleware())->handle($request);
                return;
            case 'csrf':
                (new CsrfMiddleware())->handle($request);
                return;
            case 'role':
                (new RoleMiddleware())->handle($request, $argument ?? 'admin');
                return;
            case 'rate':
                (new RateLimitMiddleware())->handle($request, $argument ?? 'default');
                return;
            case 'json':
                if ($request->isWrite() && !str_contains(strtolower($request->header('content-type') ?? ''), 'json')
                    && strtoupper($request->method()) !== 'DELETE') {
                    throw ApiException::badRequest('Content-Type must be application/json.');
                }
                return;
            default:
                throw ApiException::server('Unknown middleware: ' . $name);
        }
    }

    /** @return array<int,array{method:string,path:string}> */
    public function listRoutes(): array
    {
        return array_map(
            static fn (array $route): array => [
                'method' => $route['method'],
                'path' => preg_replace('/\(\?P<[a-zA-Z_]+>\[\^\/\]\+\)/', '{param}', str_replace('#^', '', str_replace('$#', '', $route['regex']))) ?? '',
            ],
            $this->routes,
        );
    }
}
