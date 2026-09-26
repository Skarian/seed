"""Test-only byte relay to sshd for a Docker --network none container."""
import os
import select
import socket
import sys

connection = socket.create_connection(('127.0.0.1', 22), timeout=10)
connection.settimeout(None)
try:
    while True:
        readable, _, _ = select.select([connection, sys.stdin.buffer], [], [])
        for stream in readable:
            data = connection.recv(65536) if stream is connection else os.read(sys.stdin.fileno(), 65536)
            if not data:
                raise EOFError()
            if stream is connection:
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            else:
                connection.sendall(data)
except (EOFError, BrokenPipeError, ConnectionError):
    pass
finally:
    connection.close()
