@echo off
docker build -f infrastructure/init-script/Dockerfile -t lixpi/setup . && docker run -it --rm -v "%cd%:/workspace" lixpi/setup %*
