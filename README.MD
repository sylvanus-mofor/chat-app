# Real-Time Chat Application

A horizontally scalable chat application demonstrating microservices architecture, Redis Pub/Sub messaging, and Docker containerization. Built to showcase DevOps engineering practices for AWS cloud environments.

## Architecture

```
Nginx (Port 80) → Node.js/Socket.IO (Port 5000) → Redis Pub/Sub (Port 6379)
     ↓                      ↓                            ↓
Static Files          WebSocket Server              Message Broker
```

## Tech Stack

- **Frontend**: Nginx (reverse proxy + static hosting)
- **Backend**: Node.js, Express, Socket.IO
- **Cache/Broker**: Redis 7 (Pub/Sub messaging)
- **Orchestration**: Docker Compose

## DevOps Skills Demonstrated

- Container orchestration and microservices architecture
- Stateless application design for horizontal scaling
- Redis Pub/Sub for distributed messaging
- Nginx reverse proxy with WebSocket support
- Infrastructure as Code (Docker Compose)
- Service health checks and restart policies
- Private container networking

## Quick Start

```bash
# Clone and start
git clone git@github.com:sylvanus-mofor/chat-app.git
cd chat-app
docker-compose up -d --build

# Verify
docker-compose ps
docker-compose logs -f

# Access
http://localhost
```

## Complete Cleanup

```bash
docker-compose down
docker stop $(docker ps -aq)
docker rm $(docker ps -aq)
docker rmi $(docker images -q)
docker network prune -f
docker volume prune -f
docker system prune -a --volumes -f
```

## Project Structure

```
chat-app/
├── docker-compose.yml       # Service orchestration
├── backend/
│   ├── Dockerfile
│   ├── server.js           # Socket.IO + Redis Pub/Sub
│   └── package.json
└── frontend/
    ├── Dockerfile
    ├── nginx.conf          # Reverse proxy config
    ├── index.html
    ├── app.js              # Client WebSocket logic
    └── styles.css
```

## Key Features

- Real-time bidirectional WebSocket communication
- Redis Pub/Sub for multi-instance message broadcasting
- Online user tracking with join/leave notifications
- Stateless design enabling horizontal scaling
- Container health checks and auto-restart

## Docker Configuration

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
  
  app:
    build: ./app
    ports: ["5000:5000"]
    depends_on: [redis]
    environment:
      REDIS_URL: redis://redis:6379
    restart: unless-stopped
  
  frontend:
    build: ./frontend
    ports: ["80:80"]
    depends_on: [app]
    restart: unless-stopped

networks:
  chat-network:
    driver: bridge
```

## Redis Pub/Sub Implementation

**Publishing Messages**
```javascript
socket.on("chat-message", (msg) => {
  const messageData = {
    senderId: socket.id,
    username: socket.username,
    message: msg,
    room: "general",
    timestamp: Date.now()
  };
  publisherClient.publish("chat-messages", JSON.stringify(messageData));
});
```

**Subscribing to Messages**
```javascript
await subscriberClient.subscribe("chat-messages", (data, channel) => {
  const parsedData = JSON.parse(data);
  io.to(parsedData.room).emit("chat-message", parsedData);
});
```

## Nginx Configuration

```nginx
upstream backend {
    server app:5000;
}

server {
    listen 80;
    location / {
        root /usr/share/nginx/html;
        try_files $uri /index.html;
    }
    location /socket.io/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Testing

```bash
# Manual testing
# 1. Open multiple browsers at http://localhost
# 2. Enter different usernames
# 3. Send messages and verify real-time delivery

# View logs
docker-compose logs -f app
docker-compose logs -f redis

# Test Redis
docker exec -it chat-app-redis redis-cli ping
docker exec -it chat-app-redis redis-cli
> SUBSCRIBE chat-messages
```

## Troubleshooting

**Messages not received**
```bash
docker logs chat-app-app | grep "Redis Subscriber connected"
docker exec -it chat-app-redis redis-cli ping
```

**Container won't start**
```bash
docker logs chat-app-app
docker-compose down && docker-compose up --build
```

**Browser cache issues**
```bash
# Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
```

## AWS Deployment

**ECS Fargate**
```bash
# Push to ECR
aws ecr create-repository --repository-name chat-app-backend
docker tag chat-app-backend:latest <account>.dkr.ecr.us-east-1.amazonaws.com/chat-app-backend:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/chat-app-backend:latest

# Deploy with ECS task definitions + ALB + ElastiCache Redis
```

**EKS Kubernetes**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chat-app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: <ecr-uri>/chat-app-backend:latest
        env:
        - name: REDIS_URL
          value: redis://elasticache:6379
```

**Terraform IaC**
```hcl
resource "aws_ecs_cluster" "chat" {
  name = "chat-app-cluster"
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id  = "chat-redis"
  engine      = "redis"
  node_type   = "cache.t3.micro"
}

resource "aws_lb" "app" {
  name               = "chat-alb"
  load_balancer_type = "application"
}
```

## CI/CD Pipeline

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-region: us-east-1
      - name: Build and push
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin <ecr-uri>
          docker-compose build
          docker tag chat-app-backend:latest <ecr-uri>/backend:${{ github.sha }}
          docker push <ecr-uri>/backend:${{ github.sha }}
      - name: Deploy to ECS
        run: aws ecs update-service --cluster chat-app --service backend --force-new-deployment
```

## Production Hardening

- Enable HTTPS/TLS with Let's Encrypt
- Implement rate limiting in Nginx
- Add JWT/OAuth2 authentication
- Enable Redis AUTH and encryption
- Configure CORS policies
- Implement input sanitization (XSS protection)
- Use AWS Secrets Manager for credentials
- Enable container image scanning (ECR)
- Configure CloudWatch monitoring and alarms

## Monitoring

```bash
# Export logs for CloudWatch
docker-compose logs > application.log

# Key metrics to monitor
# - WebSocket connections
# - Message throughput
# - Redis commands/sec
# - Container CPU/memory
# - Nginx request rate
```

## Scaling

**Horizontal Scaling**
```bash
# Scale backend instances
docker-compose up -d --scale app=3

# In production: Use ECS service auto-scaling or HPA in Kubernetes
```

## AWS Services Mapping

- **ECS/EKS**: Container orchestration
- **ElastiCache**: Managed Redis cluster
- **ALB**: Load balancing with sticky sessions
- **ECR**: Container image registry
- **CloudWatch**: Logs and metrics
- **Secrets Manager**: Credentials management
- **VPC**: Network isolation

## License

contact author

## Author

Built by Sylvanus Mofor - AWS Certified DevOps Engineer
# chat-app
