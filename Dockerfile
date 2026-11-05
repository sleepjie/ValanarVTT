# The site in a container. Data lives in the /data volume.
#   docker build -t valanar-table .
#   docker run -d -p 8642:8642 -v valanar-data:/data -e VTT_ADMIN_PASSWORD=change-me valanar-table
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV VTT_DATA=/data VTT_NO_LOCAL_LOGIN=1 NODE_ENV=production
VOLUME /data
EXPOSE 8642
USER node
CMD ["node", "server/server.js"]
