<?php
// ============================================================
// api/tvl_latest.php
// FUNGSI: Mengirim data TVL terbaru + ringkasan
// DIPANGGIL: Dari frontend JavaScript
// ============================================================

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$data_file = __DIR__ . '/../data/tvl_history.json';

if (!file_exists($data_file)) {
    echo json_encode([
        'success' => false, 
        'error' => 'No data yet'
    ]);
    exit;
}

$json = file_get_contents($data_file);
$data = json_decode($json, true);

if (!$data || !is_array($data) || count($data) === 0) {
    echo json_encode([
        'success' => false, 
        'error' => 'No data'
    ]);
    exit;
}

$last = end($data);
$first = reset($data);
$values = array_column($data, 'v');
$stakers_values = array_column($data, 's');

// Ambil stakers terbaru (bisa dari data terakhir atau cache)
$lastStakers = $last['s'] ?? 0;

echo json_encode([
    'success' => true,
    'current' => [
        'tvl' => $last['v'],
        'stakers' => $lastStakers,
        'block' => $last['b'] ?? 0,
        'timestamp' => date('Y-m-d H:i:s', $last['t'])
    ],
    'summary' => [
        'total_points' => count($data),
        'first_data' => date('Y-m-d H:i:s', $first['t']),
        'last_data' => date('Y-m-d H:i:s', $last['t']),
        'min_tvl' => round(min($values), 8),
        'max_tvl' => round(max($values), 8),
        'avg_tvl' => round(array_sum($values) / count($values), 8),
        'min_stakers' => min($stakers_values),
        'max_stakers' => max($stakers_values)
    ]
]);
?>
