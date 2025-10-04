# FROM ubuntu:focal

# RUN /bin/apt-get update && \
#     /bin/apt-get install -y curl && \
#     curl -sL https://deb.nodesource.com/setup_14.x | bash - && \
#     /bin/apt-get update && \
#     /bin/apt-get upgrade -y && \
#     /bin/apt-get install -y nodejs ffmpeg

# WORKDIR /home/app

# ENTRYPOINT [ "bash" ]

FROM ubuntu:focal

# Install Node.js, npm, and ffmpeg
RUN apt-get update && \
    apt-get install -y curl && \
    curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000

CMD ["node", "index.js"]
