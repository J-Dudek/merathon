"""Serveur git en SSH (paramiko) pour tester la clé de l'appareil Android : 127.0.0.1:$E2E_SSH_PORT (2222), utilisateur git.

Clés acceptées : $E2E_WORK/authorized_keys (rempli par POST /user/keys du faux GitHub). Journal : $E2E_WORK/sshd.log
Clé d'hôte : $E2E_WORK/host_ecdsa (ECDSA P-256, créée au premier lancement ; ROTATE=1 en crée une nouvelle).
Prérequis : `pip install paramiko`.
"""
import os, shlex, socket, subprocess, sys, threading, time

try:
    import paramiko
except ImportError:
    sys.exit("paramiko manquant : pip install paramiko")

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get("E2E_WORK") or os.path.join(os.path.dirname(HERE), ".work")
SRV = os.path.join(WORK, "srv")
PORT = int(os.environ.get("E2E_SSH_PORT", "2222"))
AUTH = os.path.join(WORK, "authorized_keys")
LOG = open(os.path.join(WORK, "sshd.log"), "a", buffering=1)
KEYF = os.path.join(WORK, "host_ecdsa")
if os.environ.get("ROTATE") or not os.path.exists(KEYF):
    paramiko.ECDSAKey.generate(bits=256).write_private_key_file(KEYF)
HOST = paramiko.ECDSAKey(filename=KEYF)
GITENV = {"PATH": os.environ["PATH"], "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}


def log(msg):
    LOG.write("%s %s\n" % (time.strftime("%H:%M:%S"), msg))


def allowed():
    try:
        return {tuple(l.split()[:2]) for l in open(AUTH) if l.strip()}
    except FileNotFoundError:
        return set()


class Server(paramiko.ServerInterface):
    def __init__(self):
        self.cmd = None
        self.ready = threading.Event()

    def get_allowed_auths(self, username):
        return "publickey"

    def check_auth_publickey(self, username, key):
        ok = username == "git" and (key.get_name(), key.get_base64()) in allowed()
        log("auth %s %s %s -> %s" % (username, key.get_name(), key.fingerprint, "OK" if ok else "refus"))
        return paramiko.AUTH_SUCCESSFUL if ok else paramiko.AUTH_FAILED

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_exec_request(self, channel, command):
        self.cmd = command.decode()
        self.ready.set()
        return True

    def check_channel_shell_request(self, channel):
        self.cmd = None
        self.ready.set()
        return True

    def check_channel_env_request(self, channel, name, value):
        return True


def handle(sock):
    t = paramiko.Transport(sock)
    t.add_server_key(HOST)
    srv = Server()
    try:
        t.start_server(server=srv)
    except Exception as e:
        log("négociation : %r" % e)
        return
    chan = t.accept(30)
    if chan is None:
        log("pas de canal (sonde ou abandon)")
        t.close()
        return
    srv.ready.wait(10)
    if not srv.cmd:
        chan.sendall_stderr(b"Hi camille! You've successfully authenticated, but this fake forge does not provide shell access.\n")
        chan.send_exit_status(1)
        chan.close()
        return
    parts = shlex.split(srv.cmd)
    log("exec %s" % srv.cmd)
    if len(parts) != 2 or parts[0] not in ("git-upload-pack", "git-receive-pack"):
        chan.sendall_stderr(b"commande refusee\n")
        chan.send_exit_status(1)
        chan.close()
        return
    path = os.path.normpath(os.path.join(SRV, parts[1].lstrip("/")))
    if not path.startswith(SRV + "/") or not os.path.isdir(path):
        chan.sendall_stderr(("ERROR: Repository not found: %s\n" % parts[1]).encode())
        chan.send_exit_status(1)
        chan.close()
        return
    p = subprocess.Popen([parts[0], path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=GITENV)

    def pump_in():
        try:
            while True:
                d = chan.recv(65536)
                if not d:
                    break
                p.stdin.write(d)
                p.stdin.flush()
        except Exception:
            pass
        finally:
            try:
                p.stdin.close()
            except Exception:
                pass

    threading.Thread(target=pump_in, daemon=True).start()
    while True:
        d = p.stdout.read1(65536)
        if not d:
            break
        chan.sendall(d)
    err = p.stderr.read()
    if err:
        chan.sendall_stderr(err)
    code = p.wait()
    log("fin %s -> %d" % (parts[0], code))
    chan.send_exit_status(code)
    chan.shutdown_write()
    time.sleep(0.2)
    chan.close()
    t.close()


if __name__ == "__main__":
    log("hôte %s %s" % (HOST.get_name(), HOST.fingerprint))
    print("serveur SSH sur 127.0.0.1:%d, hôte %s" % (PORT, HOST.fingerprint), flush=True)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", PORT))
    s.listen(16)
    while True:
        c, _ = s.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()
