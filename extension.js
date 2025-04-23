const vscode = require('vscode');
const path = require('path');
const { exec } = require('child_process');

function activate(context) {
    let disposable = vscode.commands.registerCommand('extension.runProfiler', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active file to profile.');
            return;
        }

        const filepath = editor.document.fileName;
        const scriptPath = path.join(context.extensionPath, 'profiler', 'universal_profiler.py');

        // Create and show panel
        const panel = vscode.window.createWebviewPanel(
            'codeProfiler',
            'Code Profiler',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Set HTML content
        panel.webview.html = getWebviewContent();

        // Run profiler and capture output
        const cmd = `python3 "${scriptPath}" "${filepath}"`;
        
        // In the activate function, replace the exec call with this:

        const childProcess = exec(cmd);
        let buffer = '';

        childProcess.stdout.on('data', (data) => {

            console.log("RAW OUTPUT:", data.toString());
            buffer += data.toString();
            
            // Check for our special markers
            const startMarker = buffer.indexOf('@@@PROFILER_START@@@');
            if (startMarker === -1) return;
            
            const endMarker = buffer.indexOf('@@@PROFILER_END@@@');
            if (endMarker === -1) {
                // Process real-time updates
                const jsonStart = buffer.indexOf('{', startMarker);
                if (jsonStart === -1) return;
                
                const jsonEnd = buffer.lastIndexOf('}') + 1;
                if (jsonEnd <= jsonStart) return;
                
                const jsonStr = buffer.substring(jsonStart, jsonEnd);
                try {
                    const message = JSON.parse(jsonStr);
                    if (message.type === 'realtimeUpdate') {
                        panel.webview.postMessage(message);
                    }
                    buffer = buffer.substring(jsonEnd);
                } catch (e) {
                    console.error('Error parsing JSON:', e);
                }
            } else {
                // Process final data
                const jsonContent = buffer.substring(
                    buffer.indexOf('{', startMarker),
                    buffer.lastIndexOf('}') + 1
                );
                
                try {
                    const message = JSON.parse(jsonContent);
                    if (message.type === 'profilerData') {
                        panel.webview.postMessage(message);
                    }
                } catch (e) {
                    console.error('Error parsing JSON:', e);
                }
                
                buffer = '';
            }
        });

        childProcess.stderr.on('data', (data) => {
            panel.webview.postMessage({
                type: 'error',
                content: data.toString()
            });
        });

        childProcess.on('close', (code) => {
            if (code !== 0) {
                panel.webview.postMessage({
                    type: 'error',
                    content: `Profiler exited with code ${code}`
                });
            }
        });

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'alert':
                    vscode.window.showErrorMessage(message.text);
                    return;
            }
        }, undefined, context.subscriptions);
    });

    context.subscriptions.push(disposable);
}

function parseProfilerOutput(output) {
    // Check for our special markers
    const startMarker = output.indexOf('@@@PROFILER_START@@@');
    const endMarker = output.indexOf('@@@PROFILER_END@@@');
    
    if (startMarker === -1 || endMarker === -1) {
        return {
            realTimeData: [],
            functionStats: []
        };
    }
    
    const jsonContent = output.substring(startMarker + '@@@PROFILER_START@@@'.length, endMarker).trim();
    const lines = jsonContent.split('\n');
    
    const realTimeData = [];
    let functionStats = [];
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
            const data = JSON.parse(line);
            if (data.type === 'realtimeUpdate') {
                realTimeData.push(data.data);
            } else if (data.type === 'profilerData') {
                functionStats = data.data.functionStats;
            }
        } catch (e) {
            console.error('Error parsing JSON:', e);
        }
    }
    
    return { realTimeData, functionStats };
}

function getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Profiler</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            margin: 0;
            padding: 20px;
            color: #333;
        }
        .dashboard {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        .chart-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 15px;
        }
        .stats-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        .stats-table th, .stats-table td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        .stats-table th {
            background-color: #f5f5f5;
        }
        .real-time-display {
            grid-column: span 2;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 15px;
        }
        .metric {
            display: inline-block;
            margin-right: 20px;
            font-size: 14px;
        }
        .metric-value {
            font-weight: bold;
            font-size: 18px;
        }
        .cpu {
            color: #4e79a7;
        }
        .memory {
            color: #e15759;
        }
    </style>
</head>
<body>
    <h1>Code Profiler Dashboard</h1>
    
    <div class="real-time-display">
        <h2>Real-Time Metrics</h2>
        <div id="currentMetrics">
            <span class="metric cpu">CPU: <span class="metric-value" id="currentCpu">0.0</span>%</span>
            <span class="metric memory">Memory: <span class="metric-value" id="currentMem">0.0</span> MB</span>
            <span class="metric">Active Functions: <span class="metric-value" id="currentFunctions">None</span></span>
        </div>
        <div style="height: 300px;">
            <canvas id="realtimeChart"></canvas>
        </div>
    </div>
    
    <div class="dashboard">
        <div class="chart-container">
            <h2>CPU Usage</h2>
            <div style="height: 300px;">
                <canvas id="cpuChart"></canvas>
            </div>
        </div>
        
        <div class="chart-container">
            <h2>Memory Usage</h2>
            <div style="height: 300px;">
                <canvas id="memoryChart"></canvas>
            </div>
        </div>
    </div>
    
    <div class="chart-container" style="grid-column: span 2;">
        <h2>Function Statistics</h2>
        <table class="stats-table" id="functionStats">
            <thead>
                <tr>
                    <th>Function</th>
                    <th>Calls</th>
                    <th>Total Time</th>
                    <th>Avg CPU%</th>
                    <th>Max CPU%</th>
                    <th>Avg Mem</th>
                    <th>Max Mem</th>
                </tr>
            </thead>
            <tbody id="statsBody">
                <!-- Will be populated by JavaScript -->
            </tbody>
        </table>
    </div>

    <script>
        // Initialize charts
        const realtimeCtx = document.getElementById('realtimeChart').getContext('2d');
        const cpuCtx = document.getElementById('cpuChart').getContext('2d');
        const memoryCtx = document.getElementById('memoryChart').getContext('2d');
        
        const realtimeChart = new Chart(realtimeCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'CPU %',
                        data: [],
                        borderColor: '#4e79a7',
                        backgroundColor: 'rgba(78, 121, 167, 0.1)',
                        tension: 0.1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Memory MB',
                        data: [],
                        borderColor: '#e15759',
                        backgroundColor: 'rgba(225, 87, 89, 0.1)',
                        tension: 0.1,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'CPU %'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Memory MB'
                        },
                        grid: {
                            drawOnChartArea: false,
                        }
                    }
                }
            }
        });
        
        const cpuChart = new Chart(cpuCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'CPU Usage %',
                    data: [],
                    borderColor: '#4e79a7',
                    backgroundColor: 'rgba(78, 121, 167, 0.1)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'CPU %'
                        }
                    }
                }
            }
        });
        
        const memoryChart = new Chart(memoryCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Memory Usage MB',
                    data: [],
                    borderColor: '#e15759',
                    backgroundColor: 'rgba(225, 87, 89, 0.1)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Memory MB'
                        }
                    }
                }
            }
        });
        
        // Handle messages from the extension
        window.addEventListener('message', event => {
            console.log("Received message:", event.data);  // Add this
            const message = event.data;
            
            switch (message.type) {
                case 'profilerData':
                    updateCharts(message.data);
                    updateStatsTable(message.data.functionStats);
                    break;
                
                case 'realtimeUpdate':
                    updateRealtimeDisplay(message.data);
                    break;
                
                case 'error':
                    alert(message.content);
                    break;
            }
        });
        
        function updateRealtimeDisplay(data) {
            document.getElementById('currentCpu').textContent = data.cpu.toFixed(1);
            document.getElementById('currentMem').textContent = data.mem.toFixed(1);
            document.getElementById('currentFunctions').textContent = data.functions || 'None';
            
            // Add to realtime chart
            const timeLabel = data.time;
            realtimeChart.data.labels.push(timeLabel);
            realtimeChart.data.datasets[0].data.push(data.cpu);
            realtimeChart.data.datasets[1].data.push(data.mem);
            
            // Keep only last 60 data points
            if (realtimeChart.data.labels.length > 60) {
                realtimeChart.data.labels.shift();
                realtimeChart.data.datasets[0].data.shift();
                realtimeChart.data.datasets[1].data.shift();
            }
            
            realtimeChart.update();
        }
        
        function updateCharts(data) {
            const times = data.realTimeData.map(d => d.time);
            const cpus = data.realTimeData.map(d => d.cpu);
            const mems = data.realTimeData.map(d => d.mem);
            
            // Update CPU chart
            cpuChart.data.labels = times;
            cpuChart.data.datasets[0].data = cpus;
            cpuChart.update();
            
            // Update Memory chart
            memoryChart.data.labels = times;
            memoryChart.data.datasets[0].data = mems;
            memoryChart.update();
        }
        
        function updateStatsTable(stats) {
            const tbody = document.getElementById('statsBody');
            tbody.innerHTML = '';
            
            stats.forEach(stat => {
                const row = document.createElement('tr');
                
                row.innerHTML = \`
                    <td>\${stat.function}</td>
                    <td>\${stat.calls}</td>
                    <td>\${stat.totalTime.toFixed(3)}</td>
                    <td>\${stat.avgCpu.toFixed(1)}</td>
                    <td>\${stat.maxCpu.toFixed(1)}</td>
                    <td>\${stat.avgMem.toFixed(1)}</td>
                    <td>\${stat.maxMem.toFixed(1)}</td>
                \`;
                
                tbody.appendChild(row);
            });
        }
    </script>
</body>
</html>`;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};