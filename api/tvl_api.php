<?php
// ============================================================
// api/tvl_api.php
// FUNGSI: Mengirim data history untuk chart
// DIPANGGIL: Dari frontend JavaScript
// ============================================================

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$data_file = __DIR__ . '/../data/tvl_history.json';
$days = isset($_GET['days']) ? (int)$_GET['days'] : 30;

if (!file_exists($data_file)) {
    echo json_encode([
        'success' => false, 
        'error' => 'No data yet', 
        'data' => []
    ]);
    exit;
}

$json = file_get_contents($data_file);
$data = json_decode($json, true);

if (!$data || !is_array($data) || count($data) === 0) {
    echo json_encode([
        'success' => false, 
        'error' => 'No data', 
        'data' => []
    ]);
    exit;
}

// Filter berdasarkan hari
$cutoff = time() - ($days * 86400);
$filtered = array_filter($data, function($p) use ($cutoff) {
    return $p['t'] >= $cutoff;
});

// Format untuk chart
$result = [];
foreach ($filtered as $p) {
    $result[] = [
        'timestamp' => date('Y-m-d H:i:s', $p['t']),
        'tvl' => $p['v'],
        'stakers' => $p['s'] ?? 0,
        'block' => $p['b'] ?? 0
    ];
}

echo json_encode([
    'success' => true,
    'data' => $result,
    'total' => count($result),
    'days' => $days,
    'all_data_points' => count($data)
]);
?>
