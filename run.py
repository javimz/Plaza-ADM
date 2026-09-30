import os
import sys
import subprocess

def main():
    venv_python = os.path.join(os.path.dirname(__file__), "venv", "Scripts", "python.exe")
    if not os.path.exists(venv_python):
        venv_python = sys.executable

    print("==================================================================")
    print("  SISTEMA DE GESTIÓN ADMINISTRATIVO - AGENCIA DE VIAJES")
    print("==================================================================")
    print("  Iniciando servidor local en http://localhost:8000 ...")
    print("  Presione Ctrl+C para detener el servidor.\n")

    subprocess.run([venv_python, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"])

if __name__ == "__main__":
    main()
