#!/bin/bash

docker build -t lixpi/setup infrastructure/init-script && docker run -it --rm -v "$(pwd):/workspace" lixpi/setup
