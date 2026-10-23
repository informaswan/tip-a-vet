FROM nginx:alpine
COPY index.html styles.css *.js flag-texture.jpg logo.png /usr/share/nginx/html/
