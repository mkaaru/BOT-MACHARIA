
from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import io
import contextlib
import traceback
import json

app = Flask(__name__)
CORS(app)

@contextlib.contextmanager
def capture_output():
    """Capture stdout and stderr for code execution"""
    old_stdout, old_stderr = sys.stdout, sys.stderr
    try:
        stdout_buffer = io.StringIO()
        stderr_buffer = io.StringIO()
        sys.stdout, sys.stderr = stdout_buffer, stderr_buffer
        yield stdout_buffer, stderr_buffer
    finally:
        sys.stdout, sys.stderr = old_stdout, old_stderr

@app.route('/api/execute-python', methods=['POST'])
def execute_python():
    try:
        data = request.get_json()
        code = data.get('code', '')
        
        if not code.strip():
            return jsonify({'error': 'No code provided'}), 400
        
        # Security: Basic validation to prevent dangerous operations
        dangerous_imports = ['os', 'subprocess', 'sys', 'shutil', 'glob']
        for dangerous in dangerous_imports:
            if f'import {dangerous}' in code or f'from {dangerous}' in code:
                return jsonify({'error': f'Import of {dangerous} is not allowed for security reasons'}), 400
        
        # Capture output during code execution
        with capture_output() as (stdout_buffer, stderr_buffer):
            try:
                # Create a restricted globals environment
                restricted_globals = {
                    '__builtins__': {
                        'print': print,
                        'len': len,
                        'str': str,
                        'int': int,
                        'float': float,
                        'list': list,
                        'dict': dict,
                        'range': range,
                        'enumerate': enumerate,
                        'sum': sum,
                        'max': max,
                        'min': min,
                        'abs': abs,
                        'round': round,
                        'sorted': sorted,
                        'reversed': reversed,
                        'zip': zip,
                        'True': True,
                        'False': False,
                        'None': None,
                    },
                    'json': json,
                    'datetime': __import__('datetime'),
                    'time': __import__('time'),
                }
                
                # Execute the code
                exec(code, restricted_globals, {})
                
            except Exception as e:
                # Capture execution errors
                error_traceback = traceback.format_exc()
                return jsonify({
                    'success': False,
                    'error': str(e),
                    'traceback': error_traceback,
                    'output': stdout_buffer.getvalue(),
                    'stderr': stderr_buffer.getvalue()
                }), 500
        
        # Return successful execution result
        output = stdout_buffer.getvalue()
        stderr_output = stderr_buffer.getvalue()
        
        return jsonify({
            'success': True,
            'output': output,
            'stderr': stderr_output if stderr_output else None
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'message': 'Python executor is running'})

if __name__ == '__main__':
    print("Starting Python Executor Server...")
    print("Server will run on http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
