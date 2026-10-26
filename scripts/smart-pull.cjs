/**
 * scripts/smart-pull.cjs
 *
 * Agent Context Memory 원격 브랜치 동기화 및 충돌 정밀 하이브리드 병합 통합 CLI 도구
 *
 * [주요 동작 모드]
 *   node scripts/smart-pull.cjs          : [기본] fetch -> 가상 진단 -> 병합 -> 충돌 정밀 해소 -> 3대 품질 게이트 -> 머지 커밋
 *   node scripts/smart-pull.cjs --check  : [진단] 워킹 트리를 건드리지 않고 인메모리 가상 병합(merge-tree)으로 충돌 여부 사전 리포트
 *   node scripts/smart-pull.cjs --resolve: [해소] 이미 충돌 상태인 워킹 트리의 충돌 파일들을 정밀 하이브리드 결합 후 커밋 완결
 *   node scripts/smart-pull.cjs --dry-run: 충돌 해소 시 실제 파일 수정 없이 변경 예정 내용 미리보기
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

const ROOT_DIR = process.env.ACM_ROOT_DIR ? path.resolve(process.env.ACM_ROOT_DIR) : path.resolve(__dirname, '..');

/**
 * Git 및 쉘 명령어 동기 실행 래퍼 (Windows Pager 블록 방어)
 */
function run(cmd, options = {}) {
  const { ignoreError = false, cwd = ROOT_DIR, stdio = ['pipe', 'pipe', 'pipe'] } = options;
  try {
    const res = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio,
      env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
    });
    return res ? res.toString().trim() : '';
  } catch (err) {
    if (ignoreError) {
      return ((err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '')).trim();
    }
    throw err;
  }
}

/**
 * 1. 현재 브랜치명 획득
 */
function getCurrentBranch() {
  try {
    return run('git rev-parse --abbrev-ref HEAD');
  } catch {
    return 'main';
  }
}

/**
 * 2. 워킹 트리 변경 여부 확인
 */
function isWorkingTreeClean() {
  const status = run('git status --porcelain=v1');
  return status.length === 0;
}

/**
 * 3. 인메모리 가상 병합 사전 진단 (check-merge 호환)
 */
function checkVirtualMerge(remote = 'origin', branch = 'develop') {
  console.log(`[사전 진단] 인메모리 가상 병합(git merge-tree) 시뮬레이션 중 (${remote}/${branch})...`);
  const output = run(`git merge-tree --write-tree HEAD ${remote}/${branch}`, { ignoreError: true });

  const lines = output.split('\n');
  const conflicts = [];
  const autoMerged = [];

  lines.forEach((line) => {
    if (line.includes('CONFLICT (content): Merge conflict in ')) {
      const file = line.replace('CONFLICT (content): Merge conflict in ', '').trim();
      conflicts.push(file);
    } else if (line.startsWith('Auto-merging ')) {
      const file = line.replace('Auto-merging ', '').trim();
      autoMerged.push(file);
    }
  });

  const uniqueConflicts = [...new Set(conflicts)];
  const uniqueAutoMerged = [...new Set(autoMerged.filter((f) => !uniqueConflicts.includes(f)))];

  let ahead = 0;
  let behind = 0;
  try {
    const revCount = run(`git rev-list --left-right --count HEAD...${remote}/${branch}`);
    const parts = revCount.split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  } catch {
    // 무시
  }

  return {
    ahead,
    behind,
    conflicts: uniqueConflicts,
    autoMerged: uniqueAutoMerged,
  };
}

/**
 * 4. 현재 워킹 트리의 충돌(Unmerged) 파일 목록 파싱
 */
function getUnmergedFiles() {
  const statusRaw = run('git status --porcelain=v1', { ignoreError: true });
  if (!statusRaw) return [];

  const files = [];
  const lines = statusRaw.split(/\r?\n/).filter((l) => l.trim().length >= 3);

  for (const line of lines) {
    const code = line.slice(0, 2);
    const filePath = line.slice(3).trim();

    // UU, AA, UD, DU, AU, UA, DD 등 Unmerged 상태
    if (code === 'UU' || code === 'AA' || code === 'UD' || code === 'DU' || code === 'AU' || code === 'UA') {
      files.push(filePath.replace(/\\/g, '/'));
    }
  }

  // 만약 git status 상 표기가 일반 M이더라도 파일 내 충돌 마커가 있는 경우 보조 탐색
  if (files.length === 0) {
    for (const line of lines) {
      const filePath = line.slice(3).trim().replace(/\\/g, '/');
      const absPath = path.join(ROOT_DIR, filePath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        try {
          const content = fs.readFileSync(absPath, 'utf-8');
          if (content.includes('<<<<<<< HEAD') && content.includes('=======')) {
            files.push(filePath);
          }
        } catch {
          // 바이너리 파일 등 무시
        }
      }
    }
  }

  return [...new Set(files)];
}

/**
 * 5. 충돌 청크 정밀 하이브리드 결합 규칙 엔진 (Precision Resolution Engine)
 */

// A. Re-export 및 Import 구문 결합 검사
function tryResolveExportsOrImports(ours, theirs) {
  const oursLines = ours.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const theirsLines = theirs.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const isAllExports = (lines) => lines.length > 0 && lines.every((l) => l.startsWith('export ') || l.startsWith('//'));
  const isAllImports = (lines) => lines.length > 0 && lines.every((l) => l.startsWith('import ') || l.startsWith('//'));

  if ((isAllExports(oursLines) && isAllExports(theirsLines)) || (isAllImports(oursLines) && isAllImports(theirsLines))) {
    // 중복 제거 및 합집합 보존
    const combined = [];
    const seen = new Set();

    // 원격과 로컬 구문 모두 수용 (원격 먼저 배치 후 로컬 배치)
    const all = [...theirsLines, ...oursLines];
    for (const line of all) {
      if (!seen.has(line)) {
        seen.add(line);
        combined.push(line);
      }
    }
    return combined.join('\n');
  }

  return null;
}

// B. package.json 등 JSON 키-값 결합 검사
function tryResolveJsonKeyValues(ours, theirs, filePath) {
  if (!filePath.endsWith('.json')) return null;

  const parseLines = (text) => text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const oursLines = parseLines(ours);
  const theirsLines = parseLines(theirs);

  const isKeyVal = (l) => /^\s*"[^"]+"\s*:\s*.*,?$/.test(l.trim());
  if (oursLines.every(isKeyVal) && theirsLines.every(isKeyVal)) {
    const combined = [];
    const seenKeys = new Set();

    const extractKey = (line) => {
      const match = line.match(/"([^"]+)"\s*:/);
      return match ? match[1] : line.trim();
    };

    const all = [...theirsLines, ...oursLines];
    all.forEach((line) => {
      const key = extractKey(line);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push(line);
      }
    });

    return combined
      .map((line, idx) => {
        const trimmed = line.trimEnd();
        if (idx < combined.length - 1) {
          return trimmed.endsWith(',') ? trimmed : trimmed + ',';
        }
        return trimmed;
      })
      .join('\n');
  }

  return null;
}

// C. 단순 독립 함수 / 클래스 메서드 블록 결합 검사
function tryResolveFunctionBlocks(ours, theirs) {
  const isFunctionDecl = (text) => /^(async\s+)?function\s+[a-zA-Z0-9_$]+\s*\(/.test(text.trim());
  const isMethodDecl = (text) => /^(async\s+)?[a-zA-Z0-9_$#]+\s*\(/.test(text.trim());

  if ((isFunctionDecl(ours) && isFunctionDecl(theirs)) || (isMethodDecl(ours) && isMethodDecl(theirs))) {
    return `${theirs.trim()}\n\n${ours.trim()}`;
  }

  return null;
}

// D. JSX / Props 공존 결합 (컴포넌트 속성 병합)
function tryResolveJsxProps(ours, theirs) {
  const hasLocalIdentifier = ours.includes('data-component') || ours.includes('useScrollDetection') || ours.includes('data-testid');
  const hasRemoteDs = theirs.includes('ds={') || theirs.includes('dsKey=');

  if (hasLocalIdentifier && hasRemoteDs) {
    const tagMatchOurs = ours.match(/<([A-Za-z0-9_]+)([\s\S]*?)(\/?>)/);
    const tagMatchTheirs = theirs.match(/<([A-Za-z0-9_]+)([\s\S]*?)(\/?>)/);

    if (tagMatchOurs && tagMatchTheirs && tagMatchOurs[1] === tagMatchTheirs[1]) {
      const tagName = tagMatchOurs[1];
      const ending = tagMatchOurs[3];

      const attrsOurs = tagMatchOurs[2].trim().split(/\s+/).filter(Boolean);
      const attrsTheirs = tagMatchTheirs[2].trim().split(/\s+/).filter(Boolean);

      const mergedAttrs = [...new Set([...attrsTheirs, ...attrsOurs])];
      return `<${tagName} ${mergedAttrs.join(' ')}${ending}`;
    }
  }

  return null;
}

/**
 * 단일 충돌 청크 해결 함수
 */
function resolveConflictChunk(ours, theirs, filePath, chunkIdx) {
  // 1. Export/Import 결합
  const exportImportRes = tryResolveExportsOrImports(ours, theirs);
  if (exportImportRes !== null) {
    return { resolved: exportImportRes, rule: 'Import/Export 합집합 공존 결합' };
  }

  // 2. JSON Key-Value 결합
  const jsonRes = tryResolveJsonKeyValues(ours, theirs, filePath);
  if (jsonRes !== null) {
    return { resolved: jsonRes, rule: 'JSON 키-값 공존 결합' };
  }

  // 3. 독립 함수 블록 결합
  const fnRes = tryResolveFunctionBlocks(ours, theirs);
  if (fnRes !== null) {
    return { resolved: fnRes, rule: '독립 함수/메서드 블록 순차 공존 결합' };
  }

  // 4. JSX 태그 Props 하이브리드 결합
  const jsxRes = tryResolveJsxProps(ours, theirs);
  if (jsxRes !== null) {
    return { resolved: jsxRes, rule: 'UI 식별자 및 DataStore 바인딩 Props 공존 결합' };
  }

  // 5. 판정 불가
  return null;
}

/**
 * 파일 내 모든 충돌 마커 파싱 및 정밀 병합 적용
 */
function resolveFileConflicts(filePath, dryRun = false) {
  const absPath = path.join(ROOT_DIR, filePath);
  if (!fs.existsSync(absPath)) return { success: false, reason: '파일 없음' };

  let content = fs.readFileSync(absPath, 'utf-8');
  const conflictRegex = /<<<<<<< HEAD\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> [^\r\n]*/g;

  let match;
  let matches = [];
  while ((match = conflictRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      ours: match[1],
      theirs: match[2],
      index: match.index,
    });
  }

  if (matches.length === 0) {
    return { success: true, count: 0, details: [] };
  }

  const details = [];
  let updatedContent = content;
  let allResolved = true;

  for (let i = 0; i < matches.length; i++) {
    const chunk = matches[i];
    const resolution = resolveConflictChunk(chunk.ours, chunk.theirs, filePath, i + 1);

    if (resolution) {
      details.push({
        index: i + 1,
        rule: resolution.rule,
        resolved: resolution.resolved,
      });
      updatedContent = updatedContent.replace(chunk.fullMatch, resolution.resolved);
    } else {
      allResolved = false;
      details.push({
        index: i + 1,
        rule: '자동 판정 불가 (수동 선택 또는 확인 필요)',
        ours: chunk.ours,
        theirs: chunk.theirs,
      });
    }
  }

  if (allResolved && !dryRun) {
    fs.writeFileSync(absPath, updatedContent, 'utf-8');
  }

  return {
    success: allResolved,
    count: matches.length,
    resolvedCount: details.filter((d) => d.rule !== '자동 판정 불가 (수동 선택 또는 확인 필요)').length,
    details,
    updatedContent,
  };
}

/**
 * 6. 3대 품질 게이트 검증 파이프라인
 */
function runQualityGates() {
  console.log('\n=======================================================');
  console.log('  Agent Context Memory 병합 후 3대 품질 게이트 검증');
  console.log('=======================================================\n');

  // Gate 1: 충돌 마커 잔여 전수 검사
  console.log('[게이트 1/3] 잔여 충돌 마커(<<<<<<<) 전수 검사...');
  const diffCheck = run('git --no-pager diff --check', { ignoreError: true });
  if (diffCheck && diffCheck.includes('leftover conflict marker')) {
    console.error('  [실패] 잔여 충돌 마커가 검출되었습니다:\n', diffCheck);
    return false;
  }
  console.log('  -> 통과: 잔여 충돌 마커 0건.\n');

  // Gate 2: 디자인 토큰 무결성 감사
  console.log('[게이트 2/3] 디자인 토큰 무결성 감사 (npm run audit:tokens)...');
  try {
    run('node scripts/audit-tokens.cjs');
    console.log('  -> 통과: 미정의 고아 토큰 0건.\n');
  } catch (err) {
    console.error('  [실패] 토큰 감사 실패:\n', err.message);
    return false;
  }

  // Gate 3: Next.js Pages Router 정적 빌드 검증
  console.log('[게이트 3/3] Next.js 전체 페이지 정적 빌드 무결성 검증 (npm run build)...');
  try {
    run('npm run build', { stdio: 'inherit' });
    console.log('\n  -> 통과: Next.js 전체 빌드 100% 무결성 확인 완료.\n');
  } catch (err) {
    console.error('\n  [실패] Next.js 빌드 실패. 소스 구문 또는 임포트를 확인하십시오.');
    return false;
  }

  return true;
}

/**
 * 7. 대화형 수동 선택기 (CLI Prompt)
 */
function promptUserResolution(ours, theirs, filePath, chunkIdx) {
  return new Promise((resolve) => {
    console.log(`\n-------------------------------------------------------`);
    console.log(`[수동 선택 필요] 파일: ${filePath} (청크 #${chunkIdx})`);
    console.log(`-------------------------------------------------------`);
    console.log(`<<< [로컬 HEAD (Ours)]:\n${ours}\n===`);
    console.log(`>>> [원격 origin/develop (Theirs)]:\n${theirs}`);
    console.log(`-------------------------------------------------------`);
    console.log('선택하십시오:');
    console.log('  1: 로컬 유지 (Keep Ours)');
    console.log('  2: 원격 수용 (Keep Theirs)');
    console.log('  3: 양쪽 결합 (Ours 후 Theirs 순차 배치)');
    console.log('  4: 양쪽 결합 (Theirs 후 Ours 순차 배치)');
    console.log('  5: 건너뛰기 (충돌 마커 유지, 직접 수동 수정)');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('선택 번호 (1-5): ', (answer) => {
      rl.close();
      const choice = answer.trim();
      if (choice === '1') resolve(ours);
      else if (choice === '2') resolve(theirs);
      else if (choice === '3') resolve(`${ours.trim()}\n\n${theirs.trim()}`);
      else if (choice === '4') resolve(`${theirs.trim()}\n\n${ours.trim()}`);
      else resolve(null);
    });
  });
}

/**
 * =======================================================
 * 메인 실행 흐름
 * =======================================================
 */
async function main() {
  const args = process.argv.slice(2);
  const isCheckMode = args.includes('--check') || args.includes('-c');
  const isResolveMode = args.includes('--resolve') || args.includes('-r');
  const isDryRun = args.includes('--dry-run');
  const skipBuild = args.includes('--no-build');

  console.log('=======================================================');
  console.log('  Agent Context Memory 스마트 원격 동기화 및 정밀 병합 엔진 (smart-pull)');
  console.log('=======================================================\n');

  const currentBranch = getCurrentBranch();
  const branchArg = args.find((a) => a.startsWith('--branch='));
  const targetRemote = 'origin';
  const targetBranch = branchArg ? branchArg.split('=')[1].trim() : currentBranch;

  // ----------------------------------------------------
  // 모드 1: 가상 진단 모드 (--check)
  // ----------------------------------------------------
  if (isCheckMode) {
    console.log(`[1/2] 원격 브랜치 정보 갱신 (git fetch ${targetRemote} ${targetBranch})...`);
    try {
      run(`git fetch ${targetRemote} ${targetBranch}`);
      console.log('  -> 원격 동기화 완료.\n');
    } catch {
      console.log('  [경고] 원격 fetch 실패 (오프라인/네트워크). 로컬 캐시 기준으로 진단합니다.\n');
    }

    console.log('[2/2] 가상 병합 사전 진단 시뮬레이션...');
    const diag = checkVirtualMerge(targetRemote, targetBranch);

    console.log(`\n[브랜치 상태] 로컬 ahead: ${diag.ahead}개 커밋 / 원격 behind: ${diag.behind}개 커밋`);

    if (diag.behind === 0) {
      console.log('\n[성공] 원격의 최신 커밋이 이미 로컬에 모두 반영되어 있습니다.');
      console.log('       별도의 병합(git pull/merge)이 필요하지 않습니다.\n');
      process.exit(0);
    }

    if (diag.conflicts.length > 0) {
      console.log('\n-------------------------------------------------------');
      console.log(`[주의] 총 ${diag.conflicts.length}개 파일에서 충돌(CONFLICT)이 예상됩니다:`);
      console.log('-------------------------------------------------------');
      diag.conflicts.forEach((file) => console.log(`  [충돌 파일] ${file}`));

      if (diag.autoMerged.length > 0) {
        console.log('\n[안내] 아래 파일들은 충돌 없이 자동으로 병합됩니다:');
        diag.autoMerged.forEach((file) => console.log(`  [자동 병합] ${file}`));
      }

      console.log('\n[해결 방법]');
      console.log('  "npm run git:pull" 을 실행하면 정밀 하이브리드 결합 엔진이');
      console.log('  충돌을 자동으로 해소하고 3대 품질 게이트 검증 후 커밋을 완결합니다.\n');
      process.exit(1);
    } else {
      console.log('\n[성공] 충돌 예상 파일이 없습니다! (100% 자동 병합 가능)');
      if (diag.autoMerged.length > 0) {
        console.log('\n[자동 병합 대상]:');
        diag.autoMerged.forEach((file) => console.log(`  - ${file}`));
      }
      console.log('\n"npm run git:pull" 로 안전하게 최신 변경사항을 병합하십시오.\n');
      process.exit(0);
    }
  }

  // ----------------------------------------------------
  // 모드 2: 충돌 단독 해소 모드 (--resolve)
  // ----------------------------------------------------
  if (isResolveMode) {
    console.log('[충돌 해소 모드] 현재 워킹 트리의 충돌 파일 검사 중...');
    const unmergedFiles = getUnmergedFiles();
    const isMerging = fs.existsSync(path.join(ROOT_DIR, '.git', 'MERGE_HEAD'));

    if (unmergedFiles.length === 0) {
      if (isMerging) {
        console.log('  -> 모든 충돌이 이미 해소되어 스테이징 완료된 상태입니다.');
        console.log('  -> 3대 품질 게이트 검증 및 머지 커밋 확정으로 진행합니다.\n');
      } else {
        console.log('  -> 현재 충돌(Unmerged) 상태이거나 진행 중인 병합이 없습니다.\n');
        process.exit(0);
      }
    } else {
      console.log(`  -> 총 ${unmergedFiles.length}개의 충돌 파일이 감지되었습니다:\n`);
      unmergedFiles.forEach((f) => console.log(`     - ${f}`));
      console.log('');
    }

    let fullyResolved = true;

    for (const file of unmergedFiles) {
      console.log(`[정밀 병합 중] ${file} ...`);
      const res = resolveFileConflicts(file, isDryRun);

      if (res.success) {
        console.log(`  -> 성공: 총 ${res.count}개 충돌 청크 자동 해소 완료!`);
        res.details.forEach((d) => console.log(`     청크 #${d.index}: [${d.rule}] 적용`));
        if (!isDryRun) {
          run(`git add "${file}"`);
        }
      } else {
        console.log(`  -> 주의: 일부 청크 자동 해소 불가 (${res.resolvedCount}/${res.count} 해소됨)`);
        for (const d of res.details) {
          if (d.rule.includes('자동 판정 불가') && !isDryRun && process.stdin.isTTY) {
            const chosen = await promptUserResolution(d.ours, d.theirs, file, d.index);
            if (chosen !== null) {
              const absPath = path.join(ROOT_DIR, file);
              const currentTxt = fs.readFileSync(absPath, 'utf-8');
              const escOurs = d.ours.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const escTheirs = d.theirs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(`<<<<<<< HEAD\\r?\\n${escOurs}\\r?\\n=======\\r?\\n${escTheirs}\\r?\\n>>>>>>> [^\\r\\n]*`);
              fs.writeFileSync(absPath, currentTxt.replace(re, chosen), 'utf-8');
              console.log(`     청크 #${d.index}: 사용자 수동 선택 반영 완료`);
            } else {
              fullyResolved = false;
            }
          } else if (d.rule.includes('자동 판정 불가')) {
            fullyResolved = false;
          }
        }
        if (!fullyResolved) {
          console.log(`  [경고] ${file} 파일에 미해소 충돌 마커가 남아 있습니다.`);
        } else if (!isDryRun) {
          run(`git add "${file}"`);
        }
      }
    }

    if (!fullyResolved) {
      console.error('\n[오류] 일부 충돌이 자동으로 해소되지 않았습니다. 해당 파일을 직접 확인하십시오.\n');
      process.exit(1);
    }

    if (isDryRun) {
      console.log('\n[Dry-Run 완료] 실제 파일 쓰기 및 커밋은 수행되지 않았습니다.\n');
      process.exit(0);
    }

    // 3대 품질 게이트 실행
    if (!skipBuild) {
      const gatesPass = runQualityGates();
      if (!gatesPass) {
        console.error('\n[품질 게이트 실패] 3대 품질 게이트를 통과하지 못하여 커밋이 보류되었습니다.\n');
        process.exit(1);
      }
    }

    // 머지 커밋 확정
    console.log('[머지 커밋 생성 중] 원자적 머지 커밋을 확정합니다...');
    const commitMsg = `merge: 원격(${targetRemote}/${targetBranch}) 최신 변경사항 정밀 하이브리드 병합`;
    try {
      run(`git commit -m "${commitMsg}"`);
      const newSha = run('git rev-parse --short HEAD');
      console.log(`\n[성공] 정밀 하이브리드 병합 및 머지 커밋 완료! (Commit: ${newSha})\n`);
      process.exit(0);
    } catch (err) {
      console.error('  [오류] 머지 커밋 실패:', err.message);
      process.exit(1);
    }
  }

  // ----------------------------------------------------
  // 모드 3: 원스톱 풀 & 정밀 병합 모드 (기본)
  // ----------------------------------------------------
  console.log('[1/5] 워킹 트리 상태 확인 중...');
  if (!isWorkingTreeClean()) {
    console.error('\n[오류] 워킹 트리에 커밋되지 않은 변경사항이 있습니다.');
    console.error('       먼저 "npm run git:commit" 또는 stash로 작업본을 정리한 후 실행하십시오.\n');
    process.exit(1);
  }
  console.log('  -> 워킹 트리 청결 상태 확인 완료.\n');

  console.log(`[2/5] 원격 저장소 동기화 (git fetch ${targetRemote} ${targetBranch})...`);
  try {
    run(`git fetch ${targetRemote} ${targetBranch}`);
    console.log('  -> 원격 최신화 완료.\n');
  } catch (err) {
    console.error('  [오류] 원격 fetch 실패:', err.message);
    process.exit(1);
  }

  console.log('[3/5] 사전 가상 병합 진단...');
  const diag = checkVirtualMerge(targetRemote, targetBranch);
  console.log(`  -> 로컬 ahead: ${diag.ahead}개 커밋 / 원격 behind: ${diag.behind}개 커밋`);

  if (diag.behind === 0) {
    console.log('\n[안내] 이미 원격의 모든 최신 커밋이 반영되어 있습니다. 작업을 종료합니다.\n');
    process.exit(0);
  }

  if (diag.ahead === 0) {
    console.log('\n[Fast-forward] 로컬 커밋이 없으므로 단순 Fast-forward 병합을 수행합니다...');
    run(`git merge --ff-only ${targetRemote}/${targetBranch}`);
    console.log('\n[성공] 최신 원격 변경사항 반영 완료.\n');
    process.exit(0);
  }

  // 병합 시도
  console.log(`\n[4/5] 원격 브랜치 병합 실행 (git merge ${targetRemote}/${targetBranch})...`);
  let mergeFailed = false;
  try {
    run(`git merge ${targetRemote}/${targetBranch}`);
    console.log('  -> 충돌 없이 100% 자동 병합 완료!\n');
  } catch (err) {
    mergeFailed = true;
    console.log('  -> 충돌(Conflict) 발생 감지. 정밀 하이브리드 결합 엔진을 가동합니다.\n');
  }

  if (!mergeFailed) {
    if (!skipBuild) {
      const gatesPass = runQualityGates();
      if (!gatesPass) {
        console.error('\n[경고] 빌드 검증에 실패했습니다. 코드를 확인하십시오.\n');
        process.exit(1);
      }
    }
    const newSha = run('git rev-parse --short HEAD');
    console.log(`\n[성공] 원격 병합이 완료되었습니다. (Commit: ${newSha})\n`);
    process.exit(0);
  }

  // 충돌 해소 파이프라인 가동
  console.log('[5/5] 정밀 하이브리드 결합 엔진 가동...');
  const unmergedFiles = getUnmergedFiles();
  console.log(`  -> 충돌 발생 파일 수: ${unmergedFiles.length}개\n`);

  let fullyResolved = true;

  for (const file of unmergedFiles) {
    console.log(`  [정밀 분석 및 결합] ${file} ...`);
    const res = resolveFileConflicts(file, isDryRun);

    if (res.success) {
      console.log(`    -> 성공: ${res.count}개 충돌 청크 자동 해소 완료!`);
      res.details.forEach((d) => console.log(`       청크 #${d.index}: [${d.rule}] 적용`));
      if (!isDryRun) {
        run(`git add "${file}"`);
      }
    } else {
      console.log(`    -> 주의: 일부 청크 자동 해소 불가 (${res.resolvedCount}/${res.count} 해소됨)`);
      for (const d of res.details) {
        if (d.rule.includes('자동 판정 불가') && !isDryRun && process.stdin.isTTY) {
          const chosen = await promptUserResolution(d.ours, d.theirs, file, d.index);
          if (chosen !== null) {
            const absPath = path.join(ROOT_DIR, file);
            const currentTxt = fs.readFileSync(absPath, 'utf-8');
            const escOurs = d.ours.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escTheirs = d.theirs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`<<<<<<< HEAD\\r?\\n${escOurs}\\r?\\n=======\\r?\\n${escTheirs}\\r?\\n>>>>>>> [^\\r\\n]*`);
            fs.writeFileSync(absPath, currentTxt.replace(re, chosen), 'utf-8');
            console.log(`       청크 #${d.index}: 사용자 수동 선택 반영 완료`);
          } else {
            fullyResolved = false;
          }
        } else if (d.rule.includes('자동 판정 불가')) {
          fullyResolved = false;
        }
      }
      if (!fullyResolved) {
        console.log(`    [경고] ${file} 파일에 미해소 충돌 마커가 남아 있습니다.`);
      } else if (!isDryRun) {
        run(`git add "${file}"`);
      }
    }
  }

  if (!fullyResolved) {
    console.error('\n[주의] 자동 해소되지 않은 파일이 있습니다. 충돌 마커를 수동 수정한 후 "npm run git:resolve"를 실행하십시오.\n');
    process.exit(1);
  }

  // 3대 품질 게이트 검증
  if (!skipBuild) {
    const gatesPass = runQualityGates();
    if (!gatesPass) {
      console.error('\n[품질 게이트 실패] 3대 품질 게이트를 통과하지 못하여 머지 커밋 생성이 보류되었습니다.');
      console.error('문제를 수정한 후 "npm run git:resolve"를 실행하십시오.\n');
      process.exit(1);
    }
  }

  // 머지 커밋 확정
  console.log('\n[머지 커밋 생성 중] 하이브리드 병합 커밋을 생성합니다...');
  const commitMsg = `merge: 원격(${targetRemote}/${targetBranch}) 최신 변경사항 정밀 하이브리드 병합`;
  try {
    run(`git commit -m "${commitMsg}"`);
    const newSha = run('git rev-parse --short HEAD');
    console.log(`\n=======================================================`);
    console.log(`  [성공] 원격 정밀 병합 및 품질 게이트 통과 완료!`);
    console.log(`  머지 커밋 SHA: ${newSha}`);
    console.log(`=======================================================\n`);
    process.exit(0);
  } catch (err) {
    console.error('  [오류] 머지 커밋 실패:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[치명적 오류]:', err);
  process.exit(1);
});
