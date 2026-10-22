# Learned Patterns Index (지식 베이스 경량 색인표)

> [!IMPORTANT]
> **0토큰 온디맨드 검색 원칙 (Just-In-Time Grep)**:
> 1. AI 에이전트는 본 파일이나 하위 패턴 디렉터리를 무조건 전수 통조회하지 않습니다.
> 2. 작업 키워드로 본 파일의 요약 열을 `grep_search`하여 매칭된 샤딩 파일(`patterns/P-XX-*.md`)만 선별 로딩합니다.
> 3. 신규 솔루션 증류 시 다음 불변 번호(`P-03`) 샤딩 파일을 생성하고, 본 인덱스에 1행을 추가합니다.

| ID | 카테고리 | 핵심 요약 | 파일 링크 |
| :--- | :--- | :--- | :--- |
| **P-01** | Git/도구 | 대화형 Pager로 인한 Git CLI 프로세스 프리징 방지 (`PAGER=cat` 강제) | [P-01-git-pager-freeze-fix.md](file:///./patterns/P-01-git-pager-freeze-fix.md) |
| **P-02** | 형상관리 | 작업 단위(Task-Centric) 원자적 커밋 거버넌스 및 자동 분류 | [P-02-atomic-commit-governance.md](file:///./patterns/P-02-atomic-commit-governance.md) |
