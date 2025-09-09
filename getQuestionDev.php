<?php
// Lista de dominios permitidos
$allowed_origins = [
    'https://ccna-vp.web.app',
    'http://localhost:5051',
    'http://localhost:5500'
];

// Detectar el origen de la petici贸n
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    header("Access-Control-Allow-Origin: $origin");
    header("Access-Control-Allow-Credentials: true");
    header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization");
}

// Preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

header("Content-Type: application/json");


// ------------------------------------------------------------
// 🔐 Firebase Auth Verification
require 'vendor/autoload.php';

use Kreait\Firebase\Factory;
use Kreait\Firebase\Auth;
use Kreait\Firebase\Exception\Auth\InvalidToken;

try {
    $factory = (new Factory)->withServiceAccount('/home/itedodgl/data/ccna-vp-firebase-adminsdk-fbsvc-df01ea54ec.json');
    $auth    = $factory->createAuth();

    $headers = getallheaders();
    $idToken = $headers['Authorization'] ?? '';
    $idToken = str_replace('Bearer ', '', $idToken);

    if (empty($idToken)) {
        http_response_code(401);
        echo json_encode(['error' => 'Missing auth token']);
        exit;
    }

    $verifiedToken = $auth->verifyIdToken($idToken);
} catch (InvalidToken $e) {
    http_response_code(401);
    echo json_encode([
        'error' => 'Invalid token',
        'details' => $e->getMessage() // ← this will tell us the exact problem
    ]);
    exit;
} catch (Throwable $e) {
    http_response_code(500);
    // return the real exception message for debugging
    echo json_encode([
      'error'   => 'Auth error',
      'message' => $e->getMessage()
    ]);
    exit;
}

// ------------------------------------------------------------



// Obtener el ID
$id = $_GET['id'] ?? null;
if (!$id) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing question id']);
    exit;
}



// Cargar XML desde ruta protegida
$questionsFile = '/home/itedodgl/data/questions_ddwtos.xml';

libxml_use_internal_errors(true);
$xml = simplexml_load_file($questionsFile);
if ($xml === false) {
    $errors = libxml_get_errors();
    $errorMessages = [];
    foreach ($errors as $error) {
        $errorMessages[] = trim($error->message);
    }
    libxml_clear_errors();
    echo json_encode(['error' => 'Failed to parse XML', 'details' => $errorMessages]);
    exit;
}

// Buscar la pregunta por ID
foreach ($xml->question as $question) {
    $name = (string)$question->name->text;
    if ($name !== $id) continue;

    $type = (string)$question['type'];
    $questionText = (string)$question->questiontext->text;

    // Reemplazar im谩genes codificadas
    if (isset($question->questiontext->file)) {
        foreach ($question->questiontext->file as $file) {
            $fileName = (string)$file['name'];
            $fileData = trim((string)$file);
            $mimeType = 'image/jpeg'; // Puedes adaptar seg煤n extensi贸n
            $base64 = "data:$mimeType;base64,$fileData";
            $questionText = str_replace("@@PLUGINFILE@@/$fileName", $base64, $questionText);
        }
    }

    if ($type === 'multichoice') {
        $answers = [];
        $correctIndexes = [];
        $index = 0;
        $isSingle = strtolower((string)$question->single) === 'true';

        foreach ($question->answer as $answer) {
            $ansText = trim((string)$answer->text);
            $answers[] = $ansText;

            if (floatval($answer['fraction']) > 0) {
                $correctIndexes[] = $index;
            }
            $index++;
        }

        echo json_encode([
            'id' => $id,
            'type' => 'multichoice',
            'text' => $questionText,
            'options' => $answers,
            'correctIndexes' => $correctIndexes,
            'isSingle' => $isSingle
        ]);
        exit;
    }

    elseif ($type === 'ddwtos') {
        $groups = [];
        foreach ($question->dragbox as $drag) {
            $groupId = (string)$drag->group;
            $label = trim((string)$drag->text);
            $groups[$groupId] = $label;
        }

        $items = [];
        $pattern = '/(.+?)\s*\[\[(\d+)\]\]/';
        if (preg_match_all($pattern, $questionText, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $desc = trim($match[1]);
                $grp = $match[2];
                $items[] = ['text' => $desc, 'group' => $grp];
            }
        }

        foreach ($items as $item) {
            $grp = $item['group'];
            if (!isset($groups[$grp])) {
                $groups[$grp] = "Group $grp";
            }
        }

        echo json_encode([
            'id' => $id,
            'type' => 'ddwtos',
            'text' => $questionText,
            'groups' => $groups,
            'items' => $items
        ]);
        exit;
    }

    elseif ($type === 'matching') {
        $pairs = [];
        foreach ($question->subquestion as $sub) {
            $left = trim((string)$sub->text);
            $right = trim((string)$sub->answer->text);
            $pairs[] = ['left' => $left, 'right' => $right];
        }
    

        echo json_encode([
            'id' => $id,
            'type' => 'matching',
            'text' => $questionText,
            'pairs' => $pairs
        ]);
        exit;
    }
    
    elseif ($type === 'truefalse') {
    $correctAnswer = null;
    foreach ($question->answer as $answer) {
        if (floatval($answer['fraction']) > 0) {
            $correctAnswer = strtolower(trim((string)$answer->text)) === 'true';
            break;
        }
    }

    echo json_encode([
        'id' => $id,
        'type' => 'truefalse',
        'text' => $questionText,
        'correct' => $correctAnswer
    ]);
    exit;
}
}

http_response_code(404);
echo json_encode(['error' => 'Question not found']);
