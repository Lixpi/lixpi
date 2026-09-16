#!/bin/bash

docker build -f infrastructure/init-script/Dockerfile -t lixpi/setup . && docker run -it --rm -v "$(pwd):/workspace" lixpi/setup "$@"
