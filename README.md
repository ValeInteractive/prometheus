# Prometheus

A Jellyfin frontend with a Fire TV wrapper.

- Web app source and Dockerfile are in `prometheus/`.
- Fire TV source and Gradle wrapper are in `prometheus-firetv/`.
- To build the wrapper, run `bash ./gradlew assembleDebug -PprometheusServerUrl=https://prometheus.example.com/` from `prometheus-firetv/`, using your own HTTPS origin with a certificate trusted by the device.
- Supply Jellyfin and session configuration through your deployment environment. Keep passwords, signing keys, session databases, and private deployment files outside this repository.

[How Prometheus works](HOW-IT-WORKS.md)
