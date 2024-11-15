# Use the official Node.js image as the base image
FROM node:22

# Set the working directory
WORKDIR /publisher-app

# Copy package.json and package-lock.json
COPY package.json ./

# Install dependencies
RUN npm install

# Copy the application files
COPY . .

# Start the application
CMD npm start