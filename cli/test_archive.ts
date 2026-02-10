// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for dn archive subcommand
 *
 * These tests create temporary git repositories with plan files and run the archive command
 * to verify its behavior in isolated environments.
 */

import { assert } from "@std/assert";
import {
  assertGitState,
  cleanupTestRepo,
  createProjectTestRepo,
  createTestRepo,
  runDnCommand,
} from "./test_utils.ts";

Deno.test("archive command shows help", async () => {
  const testRepo = await createTestRepo();

  try {
    const result = await runDnCommand(["archive", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.stdout.includes("dn archive"));
    assert(result.stdout.includes("--yolo"));
    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command fails without plan file", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["archive"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command fails with non-existent plan file", async () => {
  const testRepo = await createTestRepo();

  try {
    await runDnCommand(["archive", "non-existent.plan.md"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command derives commit message from plan file", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create a plan file with structured content
    const planContent = `# Plan: Feature Implementation

## Issue
#123: Add user authentication feature

## Summary
Implement user authentication with JWT tokens and secure password handling.

## Implementation Steps

### Step 1: Set up authentication infrastructure
- Create user model and database schema
- Implement password hashing utilities
- Set up JWT token generation and validation

### Step 2: Create authentication endpoints
- POST /auth/login - User login
- POST /auth/register - User registration
- POST /auth/refresh - Token refresh
- POST /auth/logout - User logout

### Step 3: Add authentication middleware
- Create authentication middleware for protected routes
- Implement role-based access control
- Add token validation to API endpoints

### Step 4: Update existing features
- Add user context to existing endpoints
- Update user management features
- Add authentication to UI components

## Acceptance Criteria
- [ ] Users can register with email and password
- [ ] Users can login and receive JWT tokens
- [ ] Tokens can be refreshed before expiration
- [ ] Protected routes require valid authentication
- [ ] Passwords are securely hashed
- [ ] Role-based access control works correctly

## Files to Create
- src/auth/user-model.ts
- src/auth/password-utils.ts
- src/auth/jwt-utils.ts
- src/auth/middleware.ts
- src/api/auth-endpoints.ts
- tests/auth/auth.test.ts

## Files to Modify
- src/main.ts
- src/api/user-endpoints.ts
- deno.json

## Dependencies
- @djwt for JWT handling
- @std/crypto for password hashing

## Notes
This implementation follows security best practices for authentication systems.
All passwords are hashed using bcrypt with appropriate salt rounds.
JWT tokens have reasonable expiration times and secure signing.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/auth-feature.plan.md`,
      planContent,
    );

    // Run archive command to derive commit message
    const result = await runDnCommand([
      "archive",
      "auth-feature.plan.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check that the output contains a derived commit message
    assert(
      result.stdout.includes("commit") || result.stdout.includes("message"),
    );
    assert(
      result.stdout.includes("authentication") ||
        result.stdout.includes("feature"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command with --yolo commits and deletes plan", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create some changes to commit
    const newFileContent = `// New feature implementation
export function newFeature(): string {
  return "New feature implemented";
}
`;

    await Deno.writeTextFile(`${testRepo.path}/new-feature.ts`, newFileContent);

    // Create a plan file
    const planContent = `# Plan: New Feature

## Issue
#456: Add new feature

## Summary
Implement a simple new feature.

## Acceptance Criteria
- [ ] Feature works correctly
- [ ] Tests pass
`;

    await Deno.writeTextFile(
      `${testRepo.path}/new-feature.plan.md`,
      planContent,
    );

    // Stage the changes
    await runDnCommand(["git", "add", "."], { cwd: testRepo.path });

    // Get initial git state
    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });

    // Run archive with --yolo (this will commit and delete the plan)
    const result = await runDnCommand([
      "archive",
      "new-feature.plan.md",
      "--yolo",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check git state after yolo
    await assertGitState(testRepo.path, {
      commits: 2, // Should have created a new commit
      files: ["README.md", "deno.json", "main.ts", "new-feature.ts"],
    });

    // Plan file should be deleted
    try {
      await Deno.stat(`${testRepo.path}/new-feature.plan.md`);
      throw new Error("Plan file should have been deleted with --yolo option");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // Expected - file should not exist
    }
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command validates plan file format", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create invalid plan file (missing required sections)
    const invalidPlanContent = `# Invalid Plan

This is not a valid plan file.
Missing required sections like Issue and Summary.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/invalid.plan.md`,
      invalidPlanContent,
    );

    await runDnCommand([
      "archive",
      "invalid.plan.md",
    ], {
      cwd: testRepo.path,
      expectFailure: true,
    });
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command with --workspace-root option", async () => {
  // Create nested directory structure
  const testRepo = await createProjectTestRepo();
  const subDir = `${testRepo.path}/subdir`;

  try {
    await Deno.mkdir(subDir, { recursive: true });

    const planContent = `# Plan: Workspace Root Test

## Issue
#789: Test workspace root option

## Summary
Testing workspace root option in archive command.

## Acceptance Criteria
- [ ] Workspace root is respected
`;

    await Deno.writeTextFile(
      `${testRepo.path}/workspace-test.plan.md`,
      planContent,
    );

    // Run archive from subdirectory with explicit workspace root
    const result = await runDnCommand([
      "archive",
      "workspace-test.plan.md",
      "--workspace-root",
      testRepo.path,
    ], { cwd: subDir });

    assert(result.success);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command handles complex plan with multiple sections", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    const complexPlanContent = `# Plan: Comprehensive System Overhaul

## Issue
#1000: Complete system architecture redesign and performance optimization

## Summary
This plan implements a comprehensive overhaul of the entire system architecture, focusing on performance optimization, scalability improvements, and modern development practices. The overhaul includes migrating to a microservices architecture, implementing caching strategies, optimizing database queries, and improving overall system reliability.

## Implementation Steps

### Phase 1: Architecture Foundation
1. Design new microservices architecture
2. Set up service mesh and communication protocols
3. Implement API gateway and routing
4. Create service discovery mechanisms
5. Set up distributed configuration management

### Phase 2: Data Layer Optimization
1. Implement database connection pooling
2. Add read replicas for scaling
3. Create database query optimization layer
4. Implement caching strategies (Redis)
5. Set up data synchronization services

### Phase 3: Performance Enhancements
1. Implement request/response compression
2. Add HTTP/2 support
3. Create CDN integration
4. Implement lazy loading strategies
5. Add performance monitoring and metrics

### Phase 4: Security and Reliability
1. Implement OAuth 2.0 authorization
2. Add rate limiting and throttling
3. Create circuit breaker patterns
4. Implement health check endpoints
5. Set up automated failover mechanisms

### Phase 5: Monitoring and Observability
1. Implement distributed tracing
2. Create comprehensive logging framework
3. Set up application performance monitoring
4. Create alerting and notification systems
5. Implement automated incident response

## Files to Create
- src/microservices/auth-service/
- src/microservices/user-service/
- src/microservices/data-service/
- src/gateway/api-gateway.ts
- src/caching/redis-client.ts
- src/monitoring/tracing.ts
- src/monitoring/metrics.ts
- src/monitoring/health-checks.ts
- tests/integration/microservices/
- docs/architecture/
- docs/deployment/

## Files to Modify
- src/main.ts
- src/config/
- deno.json
- docker-compose.yml
- kubernetes/

## Dependencies
- @std/http for HTTP server
- @std/json for JSON processing
- redis-client for Redis caching
- prometheus-client for metrics
- jaeger-client for distributed tracing

## Acceptance Criteria
- [ ] Microservices architecture implemented
- [ ] API gateway handles all routing
- [ ] Database performance improved by 50%
- [ ] Response times under 100ms for 95% of requests
- [ ] System can handle 10x current load
- [ ] Zero downtime deployments working
- [ ] Comprehensive monitoring in place
- [ ] Security best practices implemented
- [ ] Automated failover tested
- [ ] Documentation complete and up-to-date

## Performance Targets
- API response time: < 100ms (95th percentile)
- Database query time: < 50ms average
- System uptime: > 99.9%
- Concurrent users: 10,000+
- Request throughput: 5,000 RPS

## Security Requirements
- OAuth 2.0 with JWT tokens
- Rate limiting: 1000 requests/minute/user
- Data encryption at rest and in transit
- Regular security audits
- Compliance with GDPR and SOC 2

## Testing Strategy
- Unit tests: > 90% code coverage
- Integration tests for all service interactions
- Load testing with 10x expected traffic
- Security penetration testing
- Chaos engineering for reliability testing

## Deployment Strategy
- Blue-green deployments
- Canary releases for new features
- Automated rollback capabilities
- Infrastructure as code (Terraform)
- CI/CD pipeline with comprehensive testing

## Notes
This is a comprehensive system overhaul that will significantly improve performance, scalability, and reliability. The implementation will be done incrementally to minimize disruption to existing services. All changes will be thoroughly tested before production deployment.
`;

    await Deno.writeTextFile(
      `${testRepo.path}/system-overhaul.plan.md`,
      complexPlanContent,
    );

    // Run archive on complex plan
    const result = await runDnCommand([
      "archive",
      "system-overhaul.plan.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Check that derived commit message captures the essence
    assert(
      result.stdout.includes("system") || result.stdout.includes("overhaul") ||
        result.stdout.includes("architecture") ||
        result.stdout.includes("performance"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command creates expected git state without --yolo", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create some changes
    const newFileContent = `// Test feature
export function testFeature(): string {
  return "Test feature";
}
`;

    await Deno.writeTextFile(
      `${testRepo.path}/test-feature.ts`,
      newFileContent,
    );

    // Create a plan file
    const planContent = `# Plan: Test Feature

## Issue
#1111: Add test feature

## Summary
Implement a test feature.

## Acceptance Criteria
- [ ] Feature works
`;

    await Deno.writeTextFile(
      `${testRepo.path}/test-feature.plan.md`,
      planContent,
    );

    // Stage the changes
    await runDnCommand(["git", "add", "."], { cwd: testRepo.path });

    // Get initial git state
    await assertGitState(testRepo.path, {
      commits: 1,
      files: ["README.md", "deno.json", "main.ts"],
    });

    // Run archive without --yolo (should not commit)
    const result = await runDnCommand([
      "archive",
      "test-feature.plan.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Git state should be unchanged (no new commits)
    await assertGitState(testRepo.path, {
      commits: 1, // Should not create commits
      files: [
        "README.md",
        "deno.json",
        "main.ts",
        "test-feature.ts",
        "test-feature.plan.md",
      ],
    });

    // Plan file should still exist (no --yolo)
    try {
      await Deno.stat(`${testRepo.path}/test-feature.plan.md`);
    } catch {
      throw new Error("Plan file should still exist without --yolo option");
    }
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("archive command with unstaged changes", async () => {
  const testRepo = await createProjectTestRepo();

  try {
    // Create unstaged changes
    const newFileContent = `// Unstaged feature
export function unstagedFeature(): string {
  return "Unstaged feature";
}
`;

    await Deno.writeTextFile(`${testRepo.path}/unstaged.ts`, newFileContent);

    // Create a plan file
    const planContent = `# Plan: Unstaged Changes

## Issue
#2222: Handle unstaged changes

## Summary
Test archive with unstaged changes.

## Acceptance Criteria
- [ ] Handles unstaged changes correctly
`;

    await Deno.writeTextFile(`${testRepo.path}/unstaged.plan.md`, planContent);

    // Run archive without staging changes
    const result = await runDnCommand([
      "archive",
      "unstaged.plan.md",
    ], { cwd: testRepo.path });

    assert(result.success);

    // Should still work but warn about unstaged changes
    assert(
      result.stdout.includes("unstaged") || result.stdout.includes("changes") ||
        result.stderr.includes("unstaged") || result.stderr.includes("changes"),
    );
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
