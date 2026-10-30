FROM node:20-alpine

WORKDIR /app

# Copiar archivos de dependencias primero (capa de caché)
COPY package.json package-lock.json* ./

# Instalar dependencias dentro del contenedor
RUN npm install

# Copiar el resto del código fuente
COPY . .

# Compilar TypeScript a JavaScript
RUN npm run build

EXPOSE 4000

CMD ["node", "dist/app.js"]
