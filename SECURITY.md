# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues.

Use GitHub's **Report a vulnerability** button on the repository's
[Security page](https://github.com/BaconMan1168/optirule/security) to send a
private report. Include the affected version, reproduction steps, potential
impact, and any suggested mitigation.

If private vulnerability reporting is unavailable, email
**dguirao20@gmail.com** with the subject `optirule security report`.

You can expect an acknowledgement within seven days. Please allow time to
investigate and release a fix before publishing details.

## Scope

Reports about command execution, snapshot isolation, credential exposure,
unsafe path handling, or untrusted report content are especially useful.

Optirule invokes third-party coding-agent CLIs and user-configured success
commands. Vulnerabilities in those external tools should be reported to their
maintainers unless optirule causes or worsens the issue.
