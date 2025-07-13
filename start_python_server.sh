
#!/bin/bash

echo "Setting up Python Auto Trading Environment..."

# Install Python dependencies
pip install -r requirements_python.txt

echo "Starting Python Executor Server..."
python python_executor.py
