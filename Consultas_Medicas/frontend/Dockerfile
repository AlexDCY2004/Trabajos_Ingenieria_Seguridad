FROM node:20-alpine

WORKDIR /app

# Copiar archivos de dependencias primero (capa de caché)
COPY package.json package-lock.json* ./

# Instalar dependencias dentro del contenedor
RUN npm install

# Copiar el resto del código fuente
COPY . .

# Build de producción (Vite)
RUN npm run build

EXPOSE 5173

# Servir archivos estáticos con preview de Vite expuesto en todas las interfaces
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
