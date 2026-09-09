"""Collect generation outcomes without printing prompts or credentials."""
import contextlib,io,json,pathlib
import comfy,remote
P=pathlib.Path(__file__).parent
tests=json.loads((P/'minimax-app-tests.json').read_text())
for name,test in tests.items():
    result=comfy.api('/history/'+test['prompt_id'])
    if not result: print(name,'running/queued');continue
    row=result[test['prompt_id']]
    test['status']=row['status']['status_str']
    test['outputs']=row.get('outputs',{})
    print(name,test['status'])
    if test['status']!='success': print(row['status'])
    else:
        for output in test['outputs'].values():
            for item in output.get('gifs',[]):
                filename=str(pathlib.PurePosixPath('/workspace/ComfyUI/output')/item['subfolder']/item['filename'])
                captured=io.StringIO()
                with contextlib.redirect_stdout(captured):
                    remote.execute('import subprocess\nprint(subprocess.check_output([\'ffprobe\',\'-v\',\'error\',\'-show_entries\',\'stream=codec_type,width,height,r_frame_rate,duration,nb_frames:format=duration\',\'-of\',\'json\','+repr(filename)+'],text=True))')
                probe=json.loads(captured.getvalue())
                test['media_probe']=probe
                seconds=int(name.split('-')[2])
                video=next(s for s in probe['streams'] if s['codec_type']=='video')
                expected=(1280,720) if 'landscape' in name else (720,1280)
                assert (video['width'],video['height'])==expected, name
                assert video['r_frame_rate']=='24/1' and int(video['nb_frames'])==seconds*24, name
                assert float(probe['format']['duration'])==seconds, name
                assert any(s['codec_type']=='audio' for s in probe['streams']), name
                print(f"  Verified {expected[0]}x{expected[1]}, {seconds}s, 24fps, audio")
(P/'minimax-app-tests.json').write_text(json.dumps(tests,indent=2))
