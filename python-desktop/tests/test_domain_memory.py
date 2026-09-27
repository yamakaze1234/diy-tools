import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from domain import Domain

class DomainMemoryTests(unittest.TestCase):
    def test_materialization_keeps_history_outside_engine_without_dropping_it(self):
        domain=Domain(ROOT)
        try:
            domain.executor.submit(lambda: domain.ctx.set_memory_limit(32*1024*1024)).result()
            logs=[{'message':'x'*2048,'id':str(i)} for i in range(20000)]
            state={'configs':[],'templates':[],'sourceCatalog':[],'costSource':[],'caseGallery':[],'shopSettings':{},'logs':logs}
            result=domain('applyWorkspace',state,[])
            self.assertIs(result['logs'],logs)
            result=domain('initializeMaterializedState',result)
            self.assertIs(result['logs'],logs)
            self.assertEqual(len(result['logs']),20000)
            self.assertEqual(state['logs'][0]['message'],'x'*2048)
        finally:domain.close()
