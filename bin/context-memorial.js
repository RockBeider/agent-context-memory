#!/usr/bin/env node
/**
 * bin/context-memorial.js
 *
 * 하위 호환성(Backward Compatibility) 유지를 위한 래퍼 진입점입니다.
 * 실제 로직은 bin/context-memory.js 에서 실행됩니다.
 */

require('./context-memory.js');
