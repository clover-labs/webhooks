FROM oven/bun:1
WORKDIR /app
COPY package.json ./
COPY src/ src/
EXPOSE 3000
CMD ["bun", "src/index.ts"]
