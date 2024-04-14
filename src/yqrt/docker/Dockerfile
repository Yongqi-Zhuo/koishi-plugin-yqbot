FROM ubuntu

ENV DEBIAN_FRONTEND="noninteractive"

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    curl \
    file \
    gcc \
    git \
    libssl-dev \
    pkg-config \
 && rm -rf /var/lib/apt/lists/*

COPY yqrt /yqrt

RUN cd /yqrt && ./build.sh \
 && useradd -m app -d /app \
 && usermod -p '!!' root # Disable all passwords for root

USER app
ENV USER=app
WORKDIR /app

ENTRYPOINT [ "/yqrt/entrypoint.sh" ]
