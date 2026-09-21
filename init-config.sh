#!/bin/bash

docker build -f dev-tools/config-utils/Dockerfile -t lixpi/setup . && docker run -it --rm -v "$(pwd):/workspace" lixpi/setup "$@"
