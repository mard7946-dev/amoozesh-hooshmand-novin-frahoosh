FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/src ./src
COPY server/public ./public
COPY classroom.html /app/classroom.html
USER node
EXPOSE 8080
CMD ["npm","start"]
