<?php
// ============================================================
// api/save_tvl.php
// FUNGSI: Membaca TVL & Stakers dari blockchain RicheChain
//         Menyimpan data ke JSON file
// DIPANGGIL: Otomatis dari frontend setiap 10 detik
// ============================================================

header('Content-Type: application/json');

// ============================================
// KONFIGURASI - SESUAIKAN DENGAN DATA ANDA
// ============================================

define('RPC_URL', 'https://bsc-dataseed1.binance.org/');
define('STAKING_CONTRACT', '0x8867ad6621b790ebf555f79743c91cb6eb7c129c');
define('TOKEN_CONTRACT', '0xc55d416476CFC6e879948eD5a5F4461c43Af45Aa');
define('DATA_FILE', __DIR__ . '/../data/tvl_history.json');
define('STAKERS_CACHE', __DIR__ . '/../data/stakers_cache.json');
define('MAX_POINTS', 500);

// ============================================
// FUNGSI RPC CALL KE BLOCKCHAIN
// ============================================

function rpc_call($method, $params = []) {
    $ch = curl_init(RPC_URL);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'jsonrpc' => '2.0',
        'method' => $method,
        'params' => $params,
        'id' => 1
    ]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($error) {
        throw new Exception("RPC CURL Error: " . $error);
    }
    
    if ($httpcode != 200) {
        throw new Exception("RPC HTTP Error: " . $httpcode . " - " . $response);
    }
    
    $result = json_decode($response, true);
    if (isset($result['error'])) {
        throw new Exception("RPC Error: " . $result['error']['message']);
    }
    
    return $result['result'] ?? null;
}

// ============================================
// BACA TVL (BALANCE TOKEN DI KONTRAK STAKING)
// ============================================

function get_tvl() {
    // ERC-20 balanceOf: 0x70a08231 + address (32 bytes)
    $address = str_pad(str_replace('0x', '', STAKING_CONTRACT), 64, '0', STR_PAD_LEFT);
    $data = '0x70a08231' . $address;
    
    $result = rpc_call('eth_call', [[
        'to' => TOKEN_CONTRACT,
        'data' => $data
    ], 'latest']);
    
    // Konversi dari hex ke decimal, lalu bagi 1e18 (18 decimals)
    $tvl_wei = $result ? hexdec($result) : 0;
    return $tvl_wei / 1e18;
}

// ============================================
// BACA BLOCK NUMBER TERAKHIR
// ============================================

function get_latest_block() {
    $result = rpc_call('eth_blockNumber');
    return $result ? hexdec($result) : 0;
}

// ============================================
// HITUNG STAKERS DARI EVENT (CACHED - 24 JAM)
// ============================================

function get_stakers_count() {
    $cache_file = STAKERS_CACHE;
    
    // Cek cache
    if (file_exists($cache_file)) {
        $cache = json_decode(file_get_contents($cache_file), true);
        if ($cache && isset($cache['time']) && isset($cache['count'])) {
            // Cache berlaku 24 jam
            if ((time() - $cache['time']) < 86400) {
                return $cache['count'];
            }
        }
    }
    
    try {
        // Query event Staked
        // Keccak256 dari "Staked(address,uint256)" = 0x9e71bc8eea02f6395a8769514c1e0a5e0fea0a8e3ab6d167b45ed3e3dd5aa6e3
        $topics = ['0x9e71bc8eea02f6395a8769514c1e0a5e0fea0a8e3ab6d167b45ed3e3dd5aa6e3'];
        $params = [[
            'address' => STAKING_CONTRACT,
            'topics' => $topics,
            'fromBlock' => '0x0',
            'toBlock' => 'latest'
        ]];
        
        $result = rpc_call('eth_getLogs', $params);
        
        $stakers = [];
        if ($result && is_array($result)) {
            foreach ($result as $log) {
                if (isset($log['topics'][1])) {
                    // topics[1] = address user (indexed)
                    $address = '0x' . substr($log['topics'][1], 26);
                    $stakers[strtolower($address)] = true;
                }
            }
        }
        
        $count = count($stakers);
        
        // Simpan cache
        file_put_contents($cache_file, json_encode([
            'time' => time(),
            'count' => $count
        ]));
        
        return $count;
        
    } catch (Exception $e) {
        // Jika gagal, coba baca cache lama
        if (file_exists($cache_file)) {
            $cache = json_decode(file_get_contents($cache_file), true);
            if ($cache && isset($cache['count'])) {
                return $cache['count'];
            }
        }
        return 0;
    }
}

// ============================================
// SIMPAN DATA KE JSON
// ============================================

try {
    // 1. Baca data dari blockchain
    $tvl = get_tvl();
    $stakers = get_stakers_count();
    $block = get_latest_block();
    $now = time();
    
    // 2. Baca data lama dari JSON
    $data = [];
    if (file_exists(DATA_FILE)) {
        $json = file_get_contents(DATA_FILE);
        $data = json_decode($json, true);
        if (!is_array($data)) {
            $data = [];
        }
    }
    
    // 3. Cek data terakhir
    $last = end($data);
    
    // 4. Simpan jika: belum ada data ATAU sudah lewat 5 menit (300 detik)
    if (!$last || ($now - $last['t']) > 300) {
        
        // Tambah data baru
        $data[] = [
            't' => $now,              // timestamp (UNIX)
            'v' => round($tvl, 8),    // TVL (RECEH)
            's' => $stakers,          // jumlah stakers
            'b' => $block             // block number
        ];
        
        // Batasi jumlah data
        if (count($data) > MAX_POINTS) {
            $data = array_slice($data, -MAX_POINTS);
        }
        
        // Simpan ke file
        file_put_contents(DATA_FILE, json_encode($data, JSON_PRETTY_PRINT));
        
        // Response sukses
        echo json_encode([
            'success' => true,
            'message' => 'Data saved successfully',
            'tvl' => $tvl,
            'stakers' => $stakers,
            'block' => $block,
            'total_points' => count($data),
            'action' => 'saved'
        ]);
        
    } else {
        // Data masih fresh (kurang dari 5 menit)
        echo json_encode([
            'success' => true,
            'message' => 'Data still fresh (last update < 5 minutes)',
            'tvl' => $tvl,
            'stakers' => $stakers,
            'block' => $block,
            'total_points' => count($data),
            'action' => 'skipped',
            'last_update' => date('Y-m-d H:i:s', $last['t'])
        ]);
    }
    
} catch (Exception $e) {
    // Jika error, kirim response error
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'timestamp' => date('Y-m-d H:i:s')
    ]);
}
?>
