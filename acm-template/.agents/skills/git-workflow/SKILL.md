---
name: git-workflow
description: 작업 단위(Task-Centric) 자동 분류 커밋, 지능형 3-Way 풀, 원격 배포 위생 감사 파이프라인
---

# Git Workflow Governance Skill

본 스킬은 3계층 메모리 모델과 연동하여 작업 단위(Task-Centric) 원자적 분할 커밋, 지능형 3-Way 병합 및 원격 배포 전 형상 위생을 점검하는 표준 워크플로우를 제공합니다.

## 1. 작업 단위 자동 분류 및 원자적 커밋 (`scripts/group-status.cjs`)

### 실행 원칙
- 모든 소스 수정 및 빌드 검증이 완료된 후 실행합니다.
- 무관한 파일이 함께 커밋되는 `git add .` 일괄 커밋 대신 반드시 본 도구를 통해 분할 커밋합니다.

### 명령어
```bash
# 1. 커밋 전 작업별 파일 분류 및 상태 미리보기
node scripts/group-status.cjs --dry-run

# 2. 특정 활성 작업 번호(예: TSK-1) 단일 커밋
node scripts/group-status.cjs --commit=1

# 3. 모든 작업을 순차적으로 자동 개별 커밋
node scripts/group-status.cjs --all

# 4. 에이전트 초경량 토큰용 1줄 요약 조회
node scripts/group-status.cjs --compact
```

---

## 2. 지능형 3-Way 원격 병합 (`scripts/smart-pull.cjs`)

### 실행 원칙
- 원격 변경사항을 반영할 때 로컬 활성 작업(`task.md`)과의 충돌을 선제적으로 예방합니다.
- 단순 변경은 자동 병합하며, 복합 충돌 발생 시 3-Way 분석을 수행합니다.

### 명령어
```bash
# 기본 원격 스마트 풀
node scripts/smart-pull.cjs

# 충돌 발생 시 인터랙티브 해결 모드
node scripts/smart-pull.cjs --resolve
```

---

## 3. 원격 배포 위생 감사 (`scripts/audit-push.cjs`)

### 실행 원칙
- `git push` 실행 직전에 수행하여 임시 파일, 디버그 로그, 미해결 충돌 마커 잔재를 차단합니다.

### 명령어
```bash
node scripts/audit-push.cjs
```
