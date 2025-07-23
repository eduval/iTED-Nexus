<?php
// === TOKEN VERIFY (shared) ===
// Checks the Firebase ID token from the browser. Valid -> continue, else 401.

require __DIR__ . '/../vendor/autoload.php';

use Kreait\Firebase\Factory;
use Firebase\Auth\Token\Exception\InvalidToken;

header('Content-Type: application/json');

function deny($code = 401, $msg = 'Unauthorized') {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

try {
    $factory = (new Factory)->withServiceAccount(__DIR__ . '/../service-account.json');
    $auth    = $factory->createAuth();

    $headers = getallheaders();
    $idToken = isset($headers['Authorization'])
        ? str_replace('Bearer ', '', $headers['Authorization'])
        : '';

    if (!$idToken) deny(401, 'Missing auth token');

    $verifiedToken = $auth->verifyIdToken($idToken);
    $FIREBASE_UID  = $verifiedToken->claims()->get('sub');

} catch (InvalidToken $e) {
    deny(401, 'Unauthorized');
} catch (Throwable $e) {
    deny(500, 'Auth error');
}
