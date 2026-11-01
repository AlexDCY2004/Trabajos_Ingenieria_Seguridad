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

# Compilar TypeScript a JavaScript
RUN npm run build

# npm no se usa en ejecución y trae dependencias con vulnerabilidades (Trivy): se elimina de la imagen final
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

EXPOSE 4000

# Sin privilegios de root en tiempo de ejecución (R17): el código queda de solo lectura para el proceso
USER node

CMD ["node", "dist/app.js"]
