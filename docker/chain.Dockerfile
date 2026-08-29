# Local Hardhat blockchain node + contract deploy tooling, for docker-compose
# only (see docker-compose.yml services `chain` and `deploy-contract`). Not
# a production deployable — real environments target Polygon Amoy/mainnet.
FROM node:20-alpine

WORKDIR /app/contracts
COPY contracts/package*.json ./
RUN npm install
COPY contracts/ ./

EXPOSE 8545
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]
