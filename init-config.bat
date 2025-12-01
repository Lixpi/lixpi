@echo off
docker build -t lixpi/setup infrastructure/init-script && docker run -it --rm -v "%cd%:/workspace" lixpi/setup
