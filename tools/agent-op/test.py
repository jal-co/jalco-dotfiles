from pathlib import Path
import shlex
import subprocess
import tempfile

source = Path(__file__).with_name('op').read_text()
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    security = root / 'security.sh'
    security.write_text('''printf security >> "$TEST_TRACE"
case "$TEST_KEYCHAIN_STATE" in
  missing) exit 44 ;;
  invalid) printf invalid ;;
  valid) printf ops_test_only ;;
esac
''')
    real_op = root / 'op.sh'
    real_op.write_text('''printf op >> "$TEST_TRACE"
printf '%s\\n' "${OP_SERVICE_ACCOUNT_TOKEN-unset}" "${OP_ACCOUNT-unset}" "${OP_CONNECT_HOST-unset}" "${OP_CONNECT_TOKEN-unset}" "${OP_SESSION-unset}" "${OP_BIOMETRIC_UNLOCK_ENABLED-unset}" "$@"
''')
    wrapper = root / 'wrapper.sh'
    wrapper.write_text(source.replace('/usr/bin/security', '/bin/sh ' + shlex.quote(str(security))).replace('/opt/homebrew/bin/op', '/bin/sh ' + shlex.quote(str(real_op))))
    trace = root / 'trace'

    def run(changes):
        trace.write_text('')
        env = {'PATH': '/usr/bin:/bin', 'TEST_TRACE': str(trace), 'TEST_KEYCHAIN_STATE': 'valid', 'OP_SERVICE_ACCOUNT_TOKEN': 'caller-token', 'OP_ACCOUNT': 'caller-account', 'OP_CONNECT_HOST': 'caller-connect-host', 'OP_CONNECT_TOKEN': 'caller-connect-token', 'OP_SESSION': 'caller-session'}
        env.update(changes)
        result = subprocess.run(['/bin/sh', str(wrapper), '--vault', 'name with spaces'], env=env, capture_output=True, text=True, timeout=5)
        return result, trace.read_text()

    result, calls = run({})
    assert result.returncode == 0 and calls == 'op'
    assert result.stdout.splitlines()[:5] == ['caller-token', 'caller-account', 'caller-connect-host', 'caller-connect-token', 'caller-session']
    assert result.stdout.splitlines()[-2:] == ['--vault', 'name with spaces']

    for marker in [{'AI_AGENT': 'pi'}, {'PI_CODING_AGENT': 'true'}]:
        result, calls = run(marker)
        assert result.returncode == 0 and calls == 'securityop'
        assert result.stdout.splitlines()[:6] == ['ops_test_only', 'unset', 'unset', 'unset', 'unset', 'false']
        assert result.stdout.splitlines()[-2:] == ['--vault', 'name with spaces']

    for state in ['missing', 'invalid']:
        result, calls = run({'AI_AGENT': 'pi', 'TEST_KEYCHAIN_STATE': state})
        assert result.returncode == 1 and calls == 'security'
        assert not result.stdout
        assert 'Personal-vault authentication was not attempted.' in result.stderr

print('Passed: terminal passthrough, both Pi markers, auth isolation, argument preservation, and fail-closed token errors.')
