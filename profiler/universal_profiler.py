import os
import sys
import time
import threading
import psutil
import json
from collections import defaultdict
from datetime import datetime

class FunctionProfiler:
    def __init__(self, target_script):
        self.process = psutil.Process(os.getpid())
        self.target_script = os.path.abspath(target_script)
        self.function_stats = defaultdict(list)
        self.call_stack = []
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.sample_interval = 0.05  # 50ms
        self.per_second_log = []
        self.last_second_logged = None
        self.call_counts = defaultdict(int)
        
        # Print a special marker to indicate the start of JSON data
        print("\n@@@PROFILER_START@@@")
        sys.stdout.flush()

    def start_monitoring(self):

        print("DEBUG: Monitoring started")  # Add this
        self.process.cpu_percent(interval=None)

        while not self.stop_event.is_set():
            if not self.process.is_running():
                break

            timestamp = time.time()
            cpu = self.process.cpu_percent() 
            mem = self.process.memory_info().rss / (1024 * 1024)  # in MB

            current_second = int(timestamp)
            if current_second != self.last_second_logged:
                with self.lock:
                    active_funcs = [f.split(':')[1] for f in self.call_stack] if self.call_stack else ['<main>']
                    log_entry = {
                        'type': 'realtimeUpdate',
                        'data': {
                            'timestamp': datetime.fromtimestamp(timestamp).strftime('%H:%M:%S'),
                            'cpu': cpu,
                            'mem': mem,
                            'functions': ", ".join(active_funcs) or "<main>"
                        }
                    }
                    self.per_second_log.append(log_entry['data'])
                    self.last_second_logged = current_second

                    print("DEBUG: Sending data:", json.dumps(log_entry))  # Add this

                    # Output as JSON for the extension to parse
                    print(json.dumps(log_entry))
                    sys.stdout.flush()

            with self.lock:
                for func_info in self.call_stack:
                    self.function_stats[func_info].append((timestamp, cpu, mem))

            time.sleep(self.sample_interval)

    def function_enter(self, frame):
        filename = os.path.abspath(frame.f_code.co_filename)
        if not filename.startswith(self.target_script):
            return  # Skip system/library calls

        func_name = frame.f_code.co_name
        if func_name == '<module>':
            return  # Skip module-level code

        lineno = frame.f_lineno
        func_id = f"{os.path.basename(filename)}:{func_name}:{lineno}"

        with self.lock:
            self.call_stack.append(func_id)
            self.call_counts[func_id] += 1

    def function_exit(self, frame):
        filename = os.path.abspath(frame.f_code.co_filename)
        if not filename.startswith(self.target_script):
            return

        func_name = frame.f_code.co_name
        if func_name == '<module>':
            return

        lineno = frame.f_lineno
        func_id = f"{os.path.basename(filename)}:{func_name}:{lineno}"

        with self.lock:
            if func_id in self.call_stack:
                self.call_stack.remove(func_id)

    def get_aggregated_stats(self):
        aggregated = defaultdict(lambda: {
            'calls': 0,
            'total_time': 0,
            'total_cpu': 0,
            'max_cpu': 0,
            'total_mem': 0,
            'max_mem': 0,
            'first_seen': float('inf'),
            'last_seen': 0
        })

        for func_id, samples in self.function_stats.items():
            if not samples:
                continue

            calls = self.call_counts.get(func_id, 0)
            aggregated[func_id]['calls'] = calls

            first_time = samples[0][0]
            last_time = samples[-1][0]
            aggregated[func_id]['first_seen'] = min(aggregated[func_id]['first_seen'], first_time)
            aggregated[func_id]['last_seen'] = max(aggregated[func_id]['last_seen'], last_time)
            aggregated[func_id]['total_time'] += (last_time - first_time)

            cpu_values = [s[1] for s in samples]
            aggregated[func_id]['total_cpu'] += sum(cpu_values)
            aggregated[func_id]['max_cpu'] = max(cpu_values)

            mem_values = [s[2] for s in samples]
            aggregated[func_id]['total_mem'] += sum(mem_values)
            aggregated[func_id]['max_mem'] = max(mem_values)

        for func_id in aggregated:
            sample_count = len(self.function_stats[func_id])
            if sample_count > 0:
                aggregated[func_id]['avg_cpu'] = aggregated[func_id]['total_cpu'] / sample_count
                aggregated[func_id]['avg_mem'] = aggregated[func_id]['total_mem'] / sample_count
            else:
                aggregated[func_id]['avg_cpu'] = 0
                aggregated[func_id]['avg_mem'] = 0

        return aggregated

def profile_script(script_path):
    profiler = FunctionProfiler(script_path)

    monitor_thread = threading.Thread(target=profiler.start_monitoring)
    monitor_thread.daemon = True
    monitor_thread.start()

    def tracer(frame, event, arg):
        if event == 'call':
            profiler.function_enter(frame)
        elif event == 'return':
            profiler.function_exit(frame)
        return tracer

    sys.settrace(tracer)
    try:
        with open(script_path) as f:
            code = compile(f.read(), script_path, 'exec')
        exec(code, {'__name__': '__main__'})
    finally:
        sys.settrace(None)
        profiler.stop_event.set()
        monitor_thread.join()

    # Send final data
    stats = profiler.get_aggregated_stats()
    final_data = {
        'type': 'profilerData',
        'data': {
            'realTimeData': profiler.per_second_log,
            'functionStats': [
                {
                    'function': func,
                    'calls': data['calls'],
                    'totalTime': data['total_time'],
                    'avgCpu': data['avg_cpu'],
                    'maxCpu': data['max_cpu'],
                    'avgMem': data['avg_mem'],
                    'maxMem': data['max_mem']
                }
                for func, data in sorted(stats.items(), key=lambda x: -x[1]['total_time'])
            ]
        }
    }
    print(json.dumps(final_data))
    print("@@@PROFILER_END@@@")
    sys.stdout.flush()
    
if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python universal_profiler.py <your_script.py>")
        sys.exit(1)

    if not os.path.exists(sys.argv[1]):
        print(f"Error: File {sys.argv[1]} not found")
        sys.exit(1)

    profile_script(sys.argv[1])
