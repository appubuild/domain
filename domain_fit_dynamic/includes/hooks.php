<?php
declare(strict_types=1);

/** Minimal request-scoped Actions and Filters API for trusted PHP extensions. */
function df_register_hook(string $type, string $hook, callable $callback, int $priority, int $acceptedArgs): void
{
    if (!in_array($type, ['actions', 'filters'], true) || !preg_match('/^[A-Za-z0-9_.:-]{1,160}$/', $hook)) {
        return;
    }
    $GLOBALS['_df_hooks'] ??= ['actions' => [], 'filters' => []];
    $GLOBALS['_df_hooks'][$type][$hook][] = [
        'callback' => $callback,
        'priority' => $priority,
        'accepted_args' => max(0, min(32, $acceptedArgs)),
        'sequence' => count($GLOBALS['_df_hooks'][$type][$hook] ?? []),
    ];
}

function df_hook_callbacks(string $type, string $hook): array
{
    $callbacks = $GLOBALS['_df_hooks'][$type][$hook] ?? [];
    usort($callbacks, static function (array $left, array $right): int {
        $priorityOrder = $left['priority'] <=> $right['priority'];
        return $priorityOrder !== 0 ? $priorityOrder : $left['sequence'] <=> $right['sequence'];
    });
    return $callbacks;
}

function df_add_action(string $hook, callable $callback, int $priority = 10, int $acceptedArgs = 1): void
{
    df_register_hook('actions', $hook, $callback, $priority, $acceptedArgs);
}

function df_add_filter(string $hook, callable $callback, int $priority = 10, int $acceptedArgs = 1): void
{
    df_register_hook('filters', $hook, $callback, $priority, $acceptedArgs);
}

function df_has_action(string $hook): bool
{
    return !empty($GLOBALS['_df_hooks']['actions'][$hook]);
}

function df_do_action(string $hook, mixed ...$args): void
{
    foreach (df_hook_callbacks('actions', $hook) as $registered) {
        try {
            call_user_func_array($registered['callback'], array_slice($args, 0, $registered['accepted_args']));
        } catch (Throwable $error) {
            error_log('DomainFits extension action failed [' . $hook . ']: ' . $error->getMessage());
        }
    }
}

/** Administrative lifecycle/settings actions use this variant so errors are not reported as success. */
function df_do_action_strict(string $hook, mixed ...$args): void
{
    foreach (df_hook_callbacks('actions', $hook) as $registered) {
        call_user_func_array($registered['callback'], array_slice($args, 0, $registered['accepted_args']));
    }
}

function df_apply_filters(string $hook, mixed $value, mixed ...$args): mixed
{
    $filterArgs = array_merge([$value], $args);
    foreach (df_hook_callbacks('filters', $hook) as $registered) {
        $filterArgs[0] = $value;
        try {
            $next = call_user_func_array($registered['callback'], array_slice($filterArgs, 0, $registered['accepted_args']));
            if ($next !== null) {
                $value = $next;
            }
        } catch (Throwable $error) {
            error_log('DomainFits extension filter failed [' . $hook . ']: ' . $error->getMessage());
        }
    }
    return $value;
}

function df_request_context(): array
{
    $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
    $path = (string) (parse_url($requestUri, PHP_URL_PATH) ?: '/');
    $basePath = function_exists('app_base_path') ? app_base_path() : '';
    if ($basePath !== '' && ($path === $basePath || str_starts_with($path, $basePath . '/'))) {
        $path = substr($path, strlen($basePath)) ?: '/';
    }
    return [
        'method' => strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
        'path' => $path,
        'query' => (string) (parse_url($requestUri, PHP_URL_QUERY) ?? ''),
        'is_admin' => str_starts_with($path, '/admin/'),
        'is_cli' => PHP_SAPI === 'cli',
    ];
}

/** Starts one response buffer whose completed HTML is passed through the response.html filter. */
function df_start_response_buffer(): bool
{
    if (!empty($GLOBALS['_df_response_buffer_started']) || headers_sent() || PHP_SAPI === 'cli' || ob_get_level() >= 8) {
        return false;
    }
    $started = ob_start(static function (string $html): string {
        $filtered = df_apply_filters('response.html', $html, df_request_context());
        return is_string($filtered) ? $filtered : $html;
    });
    if ($started) {
        $GLOBALS['_df_response_buffer_started'] = true;
    }
    return $started;
}
