# B8 generated-test quality (3 runs per cell; references are constructed by this project)

| spec | healthy variants passing (want 100%) | defect variants caught (kill rate) |
| --- | --- | --- |
| vedha-promoted | 9/9 | 12/12 |
| recorder (actions only) | 9/9 | 3/12 |
| recorder + visible text | 9/9 | 3/12 |

| variant | kind | vedha-promoted | recorder (actions only) | recorder + visible text |
| --- | --- | --- | --- | --- |
| healthy | healthy | 3/3 pass | 3/3 pass | 3/3 pass |
| slow-ui (benign) | healthy | 3/3 pass | 3/3 pass | 3/3 pass |
| cookie-banner (benign) | healthy | 3/3 pass | 3/3 pass | 3/3 pass |
| silent-500 | defect | 0/3 pass | 3/3 pass | 3/3 pass |
| wrong-quantity | defect | 0/3 pass | 3/3 pass | 3/3 pass |
| dropped-write | defect | 0/3 pass | 3/3 pass | 3/3 pass |
| disabled-submit | defect | 0/3 pass | 0/3 pass | 0/3 pass |
