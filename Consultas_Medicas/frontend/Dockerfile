FROM node:20-alpine

# Parches de seguridad de Alpine (OpenSSL) para pasar el escaneo de Trivy
RUN apk upgrade --no-cache

WORKDIR /app

# Copiar archivos de dependencias primero (capa de caché)
COPY package.json package-lock.json* ./

# Instalar dependencias dentro del contenedor
RUN npm install

# Copiar el resto del código fuente
COPY . .

# Build de producción (Vite)
RUN npm run build

# npm no se usa en ejecución y trae dependencias con vulnerabilidades (Trivy): se elimina de la imagen final
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

EXPOSE 5173

# Sin privilegios de root en tiempo de ejecución (R17). Vite escribe un archivo temporal de configuración
# en node_modules/.vite-temp al arrancar: el usuario node solo es dueño de esa carpeta, no del código.
RUN mkdir -p node_modules/.vite-temp && chown node:node node_modules/.vite-temp
USER node

# Servir archivos estáticos con preview de Vite expuesto en todas las interfaces (sin npm en la imagen)
CMD ["node", "node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0", "--port", "5173"]
