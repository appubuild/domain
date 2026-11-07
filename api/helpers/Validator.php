<?php
/**
 * Declarative input validation.
 *
 *   $data = Validator::validate($request->body(), [
 *       'name'  => 'required|string|min:2|max:160',
 *       'email' => 'required|email|max:190',
 *       'status'=> 'in:published,draft',
 *   ]);
 *
 * Unknown keys are dropped (mass-assignment protection), values are coerced to
 * their declared type, and failures raise a 422 with per-field messages.
 */

declare(strict_types=1);

namespace Shn\Helpers;

final class Validator
{
    /** @var array<string,string> */
    private array $fields;

    /** @param array<string,mixed> $input
     *  @param array<string,string> $rules
     *  @return array<string,mixed>
     */
    public static function validate(array $input, array $rules): array
    {
        $validator = new self();
        return $validator->run($input, $rules);
    }

    /**
     * @param array<string,mixed> $input
     * @param array<string,string> $rules
     * @return array<string,mixed>
     */
    public function run(array $input, array $rules): array
    {
        $this->fields = [];
        $output = [];

        foreach ($rules as $field => $ruleString) {
            $parts = explode('|', $ruleString);
            $required = in_array('required', $parts, true);
            $present = array_key_exists($field, $input) && $input[$field] !== null && $input[$field] !== '';

            if (!$present) {
                if ($required) {
                    $this->fail($field, 'This field is required.');
                }
                if (in_array('nullable', $parts, true)) {
                    $output[$field] = null;
                }
                continue;
            }

            $value = $input[$field];
            $output[$field] = $this->applyRules($field, $value, $parts);
        }

        if ($this->fields !== []) {
            throw ApiException::unprocessable('Please correct the highlighted fields.', $this->fields);
        }

        return $output;
    }

    /** @param array<int,string> $parts */
    private function applyRules(string $field, mixed $value, array $parts): mixed
    {
        $type = 'string';
        $min = null;
        $max = null;

        foreach ($parts as $part) {
            [$name, $argument] = array_pad(explode(':', $part, 2), 2, null);

            switch ($name) {
                case 'required':
                case 'nullable':
                    break;

                case 'string':
                    $type = 'string';
                    if (!is_scalar($value)) {
                        $this->fail($field, 'Must be text.');
                        return null;
                    }
                    $value = trim((string) $value);
                    break;

                case 'int':
                case 'integer':
                    $type = 'int';
                    if (!is_numeric($value) || (string) (int) $value !== (string) $value) {
                        $this->fail($field, 'Must be a whole number.');
                        return null;
                    }
                    $value = (int) $value;
                    break;

                case 'bool':
                case 'boolean':
                    $type = 'bool';
                    $normalised = is_bool($value) ? $value : filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                    if ($normalised === null) {
                        $this->fail($field, 'Must be true or false.');
                        return null;
                    }
                    $value = $normalised;
                    break;

                case 'array':
                    $type = 'array';
                    if (!is_array($value)) {
                        $this->fail($field, 'Must be a list.');
                        return null;
                    }
                    break;

                case 'json':
                    $type = 'json';
                    if (is_string($value)) {
                        $decoded = json_decode($value, true);
                        if (json_last_error() !== JSON_ERROR_NONE) {
                            $this->fail($field, 'Must be valid JSON.');
                            return null;
                        }
                        $value = $decoded;
                    } elseif (!is_array($value)) {
                        $this->fail($field, 'Must be an object or array.');
                        return null;
                    }
                    break;

                case 'email':
                    if (!is_string($value) || filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
                        $this->fail($field, 'Enter a valid email address.');
                        return null;
                    }
                    break;

                case 'url':
                    if (!is_string($value) || filter_var($value, FILTER_VALIDATE_URL) === false
                        || !in_array(parse_url($value, PHP_URL_SCHEME), ['http', 'https'], true)) {
                        $this->fail($field, 'Enter a full http(s) URL.');
                        return null;
                    }
                    break;

                case 'slug':
                    if (!is_string($value) || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $value)) {
                        $this->fail($field, 'Use lowercase letters, numbers and hyphens only.');
                        return null;
                    }
                    break;

                case 'path':
                    if (!is_string($value) || !preg_match('#^/[a-zA-Z0-9\-_/]*$#', $value)) {
                        $this->fail($field, 'Use a path that starts with / and contains no spaces.');
                        return null;
                    }
                    break;

                case 'phone':
                    if (!is_string($value) || !preg_match('/^\+?[0-9][0-9\s\-().]{5,24}$/', $value)) {
                        $this->fail($field, 'Enter a dialable phone number.');
                        return null;
                    }
                    break;

                case 'date':
                    if (!is_string($value) || strtotime($value) === false) {
                        $this->fail($field, 'Enter a valid date.');
                        return null;
                    }
                    break;

                case 'in':
                    $allowed = array_map('trim', explode(',', (string) $argument));
                    if (!in_array((string) $value, $allowed, true)) {
                        $this->fail($field, 'Must be one of: ' . implode(', ', $allowed) . '.');
                        return null;
                    }
                    break;

                case 'min':
                    $min = (int) $argument;
                    if (is_string($value) && mb_strlen($value) < $min) {
                        $this->fail($field, 'Must be at least ' . $min . ' characters.');
                        return null;
                    }
                    if (is_int($value) && $value < $min) {
                        $this->fail($field, 'Must be at least ' . $min . '.');
                        return null;
                    }
                    break;

                case 'max':
                    $max = (int) $argument;
                    if (is_string($value) && mb_strlen($value) > $max) {
                        $this->fail($field, 'Must be ' . $max . ' characters or fewer.');
                        return null;
                    }
                    if (is_int($value) && $value > $max) {
                        $this->fail($field, 'Must be ' . $max . ' or less.');
                        return null;
                    }
                    break;

                case 'max_items':
                    if (is_array($value) && count($value) > (int) $argument) {
                        $this->fail($field, 'Must contain ' . $argument . ' items or fewer.');
                        return null;
                    }
                    break;

                case 'regex':
                    if (!is_string($value) || @preg_match($argument ?? '', $value) !== 1) {
                        $this->fail($field, 'Has an invalid format.');
                        return null;
                    }
                    break;

                default:
                    throw ApiException::server('Unknown validation rule: ' . $name);
            }
        }

        if ($type === 'string' && is_string($value)) {
            $value = trim($value);
        }
        if ($type === 'json' && is_array($value)) {
            $value = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        unset($min, $max);
        return $value;
    }

    private function fail(string $field, string $message): void
    {
        if (!isset($this->fields[$field])) {
            $this->fields[$field] = $message;
        }
    }

    /** Normalises a slug candidate (`Hello World!` → `hello-world`). */
    public static function slugify(string $value): string
    {
        $value = mb_strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9]+/u', '-', $value) ?? '';
        return trim($value, '-');
    }
}
