# Test suites

Normal CI and local development run a core backend suite and eight browser scenarios. The remaining tests stay in the repository and run only when requested. Fast unit tests, static checks, client builds, and Docker upgrade/restore checks remain enabled.

From the repository root:

```sh
python scripts/dev.py test
python scripts/dev.py test-browser
python scripts/dev.py test-full
python scripts/dev.py test-browser-full
```

In GitHub Actions, run the CI workflow manually and select `full_tests` to include all backend and browser tests. Pushes, pull requests, and the release workflow use the core suites by default.

The selection is maintained in `tests/suites.py`. Explicit backend or browser test arguments run the requested tests without the default selection. Direct `pytest` and Playwright commands still allow full or targeted manual runs.
