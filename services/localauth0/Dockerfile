# Stage 1: Prepare scripts with Alpine
FROM alpine:3.19 AS builder

# Copy and prepare scripts
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Stage 2: Final image
FROM public.ecr.aws/primaassicurazioni/localauth0:0.8.3

# Copy minimal shell utilities from Alpine
COPY --from=builder /bin/sh /bin/sh
COPY --from=builder /bin/busybox /bin/busybox
COPY --from=builder /lib/ld-musl-*.so.1 /lib/

# Create busybox symlinks for wget
RUN /bin/busybox --install -s /bin

# Copy scripts and config
COPY --from=builder /entrypoint.sh /entrypoint.sh
COPY localauth0.toml /localauth0.toml

# Set config file location
ENV LOCALAUTH0_CONFIG_FILE=/localauth0.toml

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
