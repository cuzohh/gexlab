# Security policy

GEXLab is a self-hosted research application. It is not designed as a multi-user service, and its public-data endpoints should not be exposed directly to the internet without an operator-managed HTTPS proxy and appropriate access and abuse controls.

Do not put API credentials, personal SEC contact details, database files, or provider payloads in issues or pull requests. Local `.env*` files and the SQLite data directory are excluded from Git.

If you find a security issue, use GitHub's private vulnerability reporting for this repository if it is enabled. Do not publish exploit details in a public issue.
