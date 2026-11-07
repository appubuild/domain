<?php
/**
 * Static integrity check — run after adding a route, controller action or model method:
 *
 *     php tests/route-check.php
 *
 * It does not touch MySQL. It verifies that:
 *   1. every handler referenced in routes/api.php exists on a real controller,
 *   2. every `$this->dependency->method()` call in a controller exists on the
 *      type declared in that controller's constructor.
 *
 * Exits non-zero on the first mismatch list so CI can gate on it.
 */

declare(strict_types=1);

$_SERVER['SCRIPT_NAME'] = '/api/index.php';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';

require dirname(__DIR__) . '/helpers/bootstrap.php';

$base = dirname(__DIR__);
$errors = [];
$routes = 0;
$calls = 0;

$routeSource = (string) file_get_contents($base . '/routes/api.php');
preg_match_all('/\[([A-Za-z]+Controller)::class,\s*\'([a-zA-Z]+)\'\]/', $routeSource, $matches, PREG_SET_ORDER);

foreach ($matches as $match) {
    $class = 'Shn\\Controllers\\' . $match[1];
    $routes++;

    if (!class_exists($class)) {
        $errors[] = "Missing controller: {$class}";
        continue;
    }
    if (!method_exists($class, $match[2])) {
        $errors[] = "Missing handler: {$match[1]}::{$match[2]}()";
    }
}

foreach (glob($base . '/controllers/*.php') ?: [] as $file) {
    $code = (string) file_get_contents($file);
    if (!preg_match('/^namespace\s+([^;]+);/m', $code, $namespace)) {
        continue;
    }

    $class = $namespace[1] . '\\' . basename($file, '.php');
    if (!class_exists($class)) {
        $errors[] = "Cannot load {$class}";
        continue;
    }

    $reflection = new ReflectionClass($class);
    $constructor = $reflection->getConstructor();
    $dependencies = [];

    if ($constructor !== null) {
        foreach ($constructor->getParameters() as $parameter) {
            $type = $parameter->getType();
            if ($type instanceof ReflectionNamedType && !$type->isBuiltin()) {
                $dependencies[$parameter->getName()] = $type->getName();
            }
        }
    }

    preg_match_all('/\$this->(\w+)->(\w+)\s*\(/', $code, $methodCalls, PREG_SET_ORDER);
    foreach ($methodCalls as $call) {
        if (!isset($dependencies[$call[1]])) {
            continue;
        }
        $calls++;
        if (!method_exists($dependencies[$call[1]], $call[2])) {
            $errors[] = "{$class}: \${$call[1]}->{$call[2]}() is not a method of {$dependencies[$call[1]]}";
        }
    }
}

printf("Routes checked: %d\nDependency calls checked: %d\n", $routes, $calls);

if ($errors !== []) {
    fwrite(STDERR, "\n" . implode("\n", array_unique($errors)) . "\n");
    exit(1);
}

echo "OK — every route handler and dependency method exists.\n";
