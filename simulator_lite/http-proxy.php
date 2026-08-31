<?php
declare(strict_types=1);

// Same-origin GET proxy for the simulator's urequests compatibility layer.
// It deliberately rejects local/private destinations so this endpoint cannot
// be used to inspect services inside the web server's network.

const MAX_RESPONSE_BYTES = 1048576;
const REQUEST_TIMEOUT_SECONDS = 10;

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function fail_request(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

function is_public_ipv4(string $address): bool
{
    return filter_var(
        $address,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    ) !== false;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    fail_request(405, 'Only GET is supported.');
}

$target = trim((string)($_GET['url'] ?? ''));
if ($target === '' || filter_var($target, FILTER_VALIDATE_URL) === false) {
    fail_request(400, 'Invalid URL.');
}

$parts = parse_url($target);
$scheme = strtolower((string)($parts['scheme'] ?? ''));
$host = strtolower((string)($parts['host'] ?? ''));
$port = isset($parts['port']) ? (int)$parts['port'] : ($scheme === 'https' ? 443 : 80);
if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
    fail_request(400, 'Only HTTP and HTTPS URLs are allowed.');
}
if (isset($parts['user']) || isset($parts['pass']) || !in_array($port, [80, 443], true)) {
    fail_request(400, 'Credentials and non-standard ports are not allowed.');
}

$addresses = filter_var($host, FILTER_VALIDATE_IP) !== false
    ? [$host]
    : (gethostbynamel($host) ?: []);
if ($addresses === [] || array_filter($addresses, static fn(string $ip): bool => !is_public_ipv4($ip))) {
    fail_request(403, 'The destination must resolve only to public IPv4 addresses.');
}
$resolvedAddress = $addresses[0];

$body = '';
$tooLarge = false;
$curl = curl_init($target);
if ($curl === false) {
    fail_request(500, 'HTTP client could not be initialized.');
}
curl_setopt_array($curl, [
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => REQUEST_TIMEOUT_SECONDS,
    CURLOPT_USERAGENT => 'ESP-IDE-Simulator-Lite/1.0',
    CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    CURLOPT_RESOLVE => [sprintf('%s:%d:%s', $host, $port, $resolvedAddress)],
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$tooLarge): int {
        if (strlen($body) + strlen($chunk) > MAX_RESPONSE_BYTES) {
            $tooLarge = true;
            return 0;
        }
        $body .= $chunk;
        return strlen($chunk);
    },
]);

$ok = curl_exec($curl);
$status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$contentType = (string)(curl_getinfo($curl, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream');
$error = curl_error($curl);
curl_close($curl);

if ($tooLarge) {
    fail_request(413, 'HTTP response exceeds 1048576 bytes.');
}
if ($ok === false) {
    fail_request(502, $error !== '' ? $error : 'The upstream HTTP request failed.');
}

http_response_code($status > 0 ? $status : 502);
header('Content-Type: ' . str_replace(["\r", "\n"], '', $contentType));
echo $body;
