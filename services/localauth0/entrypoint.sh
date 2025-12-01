#!/bin/sh
set -e

# Start LocalAuth0 - let Docker healthcheck handle readiness
exec /localauth0
